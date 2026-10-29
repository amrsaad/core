// Entscheidung 13 (core-content/docs/fundament.md): Hintergrund-Wiedergabe. Dieselben Regeln wie ios/CoreTests/BackgroundTests.swift.
import { describe, expect, it } from 'vitest';
import { atEnd, backgroundLine, countsSeenAtStart, EndLedger, isBackground, nextIn, onLeave, previousIn } from '../src/moments/background';
import { formOf } from '../src/moments/form';
import { newMomentCursor, nextMomentBlock, type MomentPrefs } from '../src/moments/mix';
import { AUDIO_ONLY, HLS, registerHls } from '../src/video/ytApi';
import type { Moment } from '../src/moments/types';

const mk = (id: string, area: Moment['area'] = 'brain', extra: Partial<Moment> = {}): Moment => ({
  id,
  videoId: id,
  start: 0,
  end: 60,
  channel: 'Channel (Name)',
  videoTitle: 't',
  area,
  topic: 'eyes',
  hook: `Hook ${id}`,
  kind: 'story',
  createdAt: '2026-10-29',
  ...extra,
});

describe('Seite verlassen', () => {
  it('eigene Streams behalten den Ton, YouTube und Text halten an', () => {
    expect(onLeave('audio', false)).toBe('keepSound');
    expect(onLeave('video', false)).toBe('keepSound');
    expect(onLeave('video', true)).toBe('pause');
    expect(onLeave('audio', true)).toBe('pause');
    expect(onLeave('text', false)).toBe('pause');
  });
  it('hidden ist Hintergrund, visible nicht', () => {
    expect(isBackground('hidden')).toBe(true);
    expect(isBackground('visible')).toBe(false);
  });
});

describe('Ende eines Moments', () => {
  it('Audio läuft im Hintergrund weiter, Video und Text stoppen', () => {
    expect(atEnd('audio', true)).toBe('advance');
    expect(atEnd('video', true)).toBe('stop');
    expect(atEnd('text', true)).toBe('stop');
  });
  it('im Vordergrund geht es wie bisher weiter', () => {
    for (const f of ['audio', 'video', 'text'] as const) expect(atEnd(f, false)).toBe('advance');
  });
});

describe('Gesehen nur bei ended', () => {
  it('Start zählt nur im Vordergrund', () => {
    expect(countsSeenAtStart(false)).toBe(true);
    expect(countsSeenAtStart(true)).toBe(false);
  });
  it('das Ende zählt einmal, auch nach der Rückkehr', () => {
    const l = new EndLedger();
    expect(l.first('a')).toBe(true);
    expect(l.first('a')).toBe(false);
    expect(l.first('b')).toBe(true);
  });
  it('Lauf im Hintergrund: jeder Moment einmal gezählt, Rückkehr zählt nicht doppelt', () => {
    const l = new EndLedger();
    const seen = new Set<string>();
    let ended = 0;
    const start = (id: string, bg: boolean) => {
      if (countsSeenAtStart(bg)) seen.add(id);
    };
    const end = (id: string) => {
      if (l.first(id)) {
        ended++;
        seen.add(id);
      }
    };
    start('a', false); // im Vordergrund gestartet, dann gesperrt
    start('b', true); // Auto-Weiter im Hintergrund
    expect([...seen]).toEqual(['a']);
    end('a');
    end('b');
    expect([...seen].sort()).toEqual(['a', 'b']);
    expect(ended).toBe(2);
    // Rückkehr: der laufende Moment wird als gesehen markiert (idempotent), ein zweites Ende zählt nicht
    seen.add('b');
    end('b');
    expect(seen.size).toBe(2);
    expect(ended).toBe(2);
  });
});

describe('Auto-Weiter ist der Wisch', () => {
  it('nimmt den Nachfolger in der Warteschlange der Mischung', () => {
    const q = ['a', 'b', 'c'].map((id) => mk(id));
    expect(nextIn(q, 'a')?.id).toBe('b');
    expect(nextIn(q, 'b')?.id).toBe('c');
    expect(nextIn(q, 'c')).toBeUndefined();
    expect(nextIn(q, 'zzz')).toBeUndefined();
    expect(nextIn(q, undefined)).toBeUndefined();
    expect(previousIn(q, 'c')?.id).toBe('b');
    expect(previousIn(q, 'a')).toBeUndefined();
  });

  it('die Folge aus der Mischung ist dieselbe, egal ob gewischt oder automatisch weitergegangen', () => {
    const pool: Moment[] = [];
    const areas = ['brain', 'body', 'beat'] as const;
    for (let i = 0; i < 30; i++) pool.push(mk(`m${i}`, areas[i % 3], { form: 'audio', audio: true }));
    const prefs: MomentPrefs = { areaShares: { brain: 1, body: 1, beat: 1 }, weights: { area: {}, channel: {}, topic: {} }, seen: {}, mutedChannels: {} };
    const rng = () => 0.5;
    const c = newMomentCursor(false);
    const queue: Moment[] = [];
    for (let i = 0; i < 4; i++) queue.push(...(nextMomentBlock(pool, prefs, c, rng) ?? []));
    expect(queue.length).toBe(12);
    // Warteschlange durchgehen wie der Feed: Auto-Weiter und Wisch lesen beide idx + 1
    for (let i = 0; i < queue.length - 1; i++) expect(nextIn(queue, queue[i].id)?.id).toBe(queue[i + 1].id);
  });
});

describe('Audio-Element nur für die Audio-Form', () => {
  it('registerHls merkt sich, welche Streams ohne Bild laufen', () => {
    HLS.clear();
    AUDIO_ONLY.clear();
    registerHls([
      { videoId: 'p1', hls: 'https://stream.test/p1.m3u8', audio: true },
      { videoId: 'p2', hls: 'https://stream.test/p2.m3u8', form: 'audio' },
      { videoId: 'v1', hls: 'https://stream.test/v1.m3u8' },
      { videoId: 'y1' },
    ]);
    expect(AUDIO_ONLY.has('p1')).toBe(true);
    expect(AUDIO_ONLY.has('p2')).toBe(true);
    expect(AUDIO_ONLY.has('v1')).toBe(false);
    expect(HLS.has('y1')).toBe(false);
    expect(formOf({ audio: true })).toBe('audio');
  });
});

describe('Diagnose', () => {
  it('zählt started, ended und next', () => {
    const log = ['bg: started m1', 'bg: ended m1', 'bg: next m2', 'bg: started m2', 'bg: stalled at m2', 'bg: left m2'];
    expect(backgroundLine(log)).toBe('background: started 2, ended 1, next 1');
    expect(backgroundLine([])).toBe('background: started 0, ended 0, next 0');
  });
});
