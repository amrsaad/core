import { describe, expect, it } from 'vitest';
import { isYtId, momentViolation, validateMoments } from '../src/moments/contract';

const EX = 'Sentence one of the checked excerpt.\nSentence two of the checked excerpt.';
const base = { channel: 'Kanal', videoTitle: 'T', area: 'brain', topic: 'augen', hook: 'Ein Hook', kind: 'regel', createdAt: '2026-10-27T00:00:00Z', start: 10, end: 70 };
const video = (o = {}) => ({ ...base, id: 'v1:10', videoId: 'dQw4w9WgXcQ', ...o });
const audio = (o = {}) => ({ ...base, id: 'a1:10', videoId: 'pod-abcdef12', form: 'audio', hls: 'https://x.test/a.m3u8', ...o });
const text = (o = {}) => ({ ...base, id: 't1:10', videoId: 'txt-abcdef12', form: 'text', excerpt: EX, ...o });

describe('isYtId', () => {
  it('echte IDs', () => {
    expect(isYtId('dQw4w9WgXcQ')).toBe(true);
    expect(isYtId('a-b_c1234567'.slice(0, 11))).toBe(true);
  });
  it('falsche Länge, Zeichen, Typ', () => {
    for (const x of ['', 'short', 'dQw4w9WgXcQ1', 'dQw4w9 gXcQ', 'dQw4w9WgXc!', undefined, null, 5]) expect(isYtId(x)).toBe(false);
  });
  it('pod- und txt-IDs sind keine YouTube-IDs, auch bei 11 Zeichen', () => {
    expect(isYtId('pod-abcdefg')).toBe(false);
    expect(isYtId('txt-abcdefg')).toBe(false);
  });
});

describe('Vertrag pro Moment', () => {
  it('gültige Fälle', () => {
    expect(momentViolation(video())).toBeNull();
    expect(momentViolation(video({ videoId: 'ted-talk-1', hls: 'https://x.test/v.m3u8' }))).toBeNull();
    expect(momentViolation(video({ form: 'video' }))).toBeNull();
    expect(momentViolation(audio())).toBeNull();
    expect(momentViolation(video({ audio: true, hls: 'https://x.test/a.m3u8', videoId: 'pod-abcdef12' }))).toBeNull();
    expect(momentViolation(text())).toBeNull();
    // Text braucht weder gültige Zeiten noch einen Stream
    expect(momentViolation(text({ start: undefined, end: undefined, hls: undefined }))).toBeNull();
  });
  it('text ohne excerpt', () => {
    expect(momentViolation(text({ excerpt: undefined }))).toBe('text ohne excerpt');
    expect(momentViolation(text({ excerpt: '   ' }))).toBe('text ohne excerpt');
    expect(momentViolation(text({ excerpt: 12 }))).toBe('text ohne excerpt');
    // Untertitel ersetzen den excerpt nicht
    expect(momentViolation(text({ excerpt: undefined, cues: [[0, 'x']] }))).toBe('text ohne excerpt');
  });
  it('audio ohne hls', () => {
    expect(momentViolation(audio({ hls: undefined }))).toBe('audio ohne hls');
    expect(momentViolation(audio({ hls: '' }))).toBe('audio ohne hls');
    // Ohne Feld form: audio true genügt als Kennzeichen
    expect(momentViolation(video({ audio: true, videoId: 'dQw4w9WgXcQ' }))).toBe('audio ohne hls');
  });
  it('video mit pod-ID und ohne hls', () => {
    expect(momentViolation(video({ videoId: 'pod-abcdefg' }))).toBe('video ohne hls und ohne YouTube-ID');
    expect(momentViolation(video({ videoId: 'pod-abc' }))).toBe('video ohne hls und ohne YouTube-ID');
  });
  it('video mit ungültiger ID', () => {
    expect(momentViolation(video({ videoId: 'abc' }))).toBe('video ohne hls und ohne YouTube-ID');
    expect(momentViolation(video({ videoId: 'txt-abcdefg' }))).toBe('video ohne hls und ohne YouTube-ID');
    expect(momentViolation(video({ videoId: 'dQw4w9WgXcQ!' }))).toBe('video ohne hls und ohne YouTube-ID');
  });
  it('Zeiten bei video und audio', () => {
    expect(momentViolation(video({ end: 10 }))).toBe('start oder end ungültig');
    expect(momentViolation(video({ start: '10' }))).toBe('start oder end ungültig');
    expect(momentViolation(video({ end: NaN }))).toBe('start oder end ungültig');
    expect(momentViolation(audio({ end: 5 }))).toBe('start oder end ungültig');
  });
  it('Pflichtfelder', () => {
    expect(momentViolation(video({ id: '' }))).toBe('id fehlt');
    expect(momentViolation(video({ videoId: undefined }))).toBe('videoId fehlt');
    expect(momentViolation(video({ channel: undefined }))).toBe('channel fehlt');
    expect(momentViolation(video({ hook: '  ' }))).toBe('hook fehlt');
    expect(momentViolation(video({ area: 'mind' }))).toBe('area ungültig');
    expect(momentViolation(video({ form: 'reel' }))).toBe('form ungültig');
  });
  it('Müll statt Moment', () => {
    for (const x of [null, undefined, 5, 'x', [], true]) expect(momentViolation(x)).toBe('kein Objekt');
  });
});

describe('Pool prüfen', () => {
  it('sortiert aus, zählt und behält die Reihenfolge', () => {
    const list = [video({ id: 'a' }), text({ id: 'b', excerpt: undefined }), audio({ id: 'c' }), audio({ id: 'd', hls: undefined }), video({ id: 'e', videoId: 'pod-abcdefg' }), text({ id: 'f' }), null, 7];
    const r = validateMoments(list);
    expect(r.moments.map((m) => m.id)).toEqual(['a', 'c', 'f']);
    expect(r.skipped).toBe(5);
    expect(r.reasons).toEqual({ 'text ohne excerpt': 1, 'audio ohne hls': 1, 'video ohne hls und ohne YouTube-ID': 1, 'kein Objekt': 2 });
  });
  it('doppelte id zählt nur einmal', () => {
    const r = validateMoments([video({ id: 'x' }), video({ id: 'x', hook: 'zweiter' })]);
    expect(r.moments).toHaveLength(1);
    expect(r.moments[0].hook).toBe('Ein Hook');
    expect(r.skipped).toBe(1);
  });
  it('wirft nie, auch nicht bei Müll als Pool', () => {
    for (const x of [undefined, null, 5, 'x', {}, { moments: [] }]) {
      const r = validateMoments(x);
      expect(r).toEqual({ moments: [], skipped: 0, reasons: {} });
    }
  });
  it('alle ungültig gibt leeren Pool, keinen Fehler', () => {
    const r = validateMoments([text({ excerpt: '' }), audio({ hls: undefined })]);
    expect(r.moments).toEqual([]);
    expect(r.skipped).toBe(2);
  });
  it('falsch typisierte optionale Felder fliegen raus, der Moment bleibt', () => {
    const r = validateMoments([
      video({ id: 'a', cues: [[0, 'ok'], ['x', 1]], recall: { question: 'q', options: ['a', 'b'], correct: 0, why: 'w' }, ref: 5, author: {}, forYou: 3 }),
      video({ id: 'b', cues: 'nein', recall: null, audio: 'ja' }),
    ]);
    expect(r.skipped).toBe(0);
    for (const m of r.moments) {
      expect(m.cues).toBeUndefined();
      expect(m.recall).toBeUndefined();
    }
    expect(r.moments[0]).not.toHaveProperty('ref');
    expect(r.moments[0]).not.toHaveProperty('author');
    expect(r.moments[0]).not.toHaveProperty('forYou');
    expect(r.moments[1]).not.toHaveProperty('audio');
  });
  it('gültige optionale Felder bleiben unverändert', () => {
    const cues = [[0, 'eins'], [2, 'zwei']];
    const recall = { question: 'q', options: ['a', 'b', 'c'], correct: 2, why: 'w' };
    const m = video({ cues, recall, forYou: 'für dich', thumb: 'https://x.test/t.png', top: true });
    const r = validateMoments([m]);
    expect(r.moments[0]).toEqual(m);
  });
});
