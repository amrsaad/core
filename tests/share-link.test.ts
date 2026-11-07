import { describe, expect, it } from 'vitest';
import { clipUrl, decodePayload, encodePayload, episodeUrlOf, payloadOf, shareOf, shareText } from '../src/share/link';
import type { Moment } from '../src/moments/types';

// Brief 05 (Entscheidung 27, Issue 21): Text in der Sprache des Tracks, Link mit base64url-JSON, nichts aus dem Pool im Link.
const base: Moment = {
  id: 'pod-abc:120',
  videoId: 'pod-abc',
  start: 120.6,
  end: 185.2,
  channel: 'قناة الطب',
  videoTitle: 'الحلقة ٣',
  area: 'brain',
  topic: 'augen',
  hook: 'العين لا تنام',
  context: 'الجملة الأولى.\nالجملة الثانية.',
  kind: 'regel',
  createdAt: '2026-10-20T00:00:00Z',
  form: 'audio',
  audio: true,
  hls: 'https://cdn.example.org/ep3.mp3',
  url: 'https://podcast.example.org/ep3',
  lang: 'ar',
};

describe('share: Inhalt des Links', () => {
  it('Audio: Datei als src, Seite der Folge als url, Zeiten ganzzahlig, RTL bei Arabisch', () => {
    const p = payloadOf(base)!;
    expect(p).toMatchObject({ v: 1, form: 'audio', src: 'https://cdn.example.org/ep3.mp3', url: 'https://podcast.example.org/ep3', start: 120, end: 185, lang: 'ar', dir: 'rtl', channel: 'قناة الطب', episode: 'الحلقة ٣' });
    expect(JSON.stringify(p)).not.toContain('pod-abc');
    expect(Object.keys(p)).not.toContain('id');
  });
  it('YouTube: die ID ist src, Link zur Folge mit Zeitstempel', () => {
    const p = payloadOf({ ...base, form: 'video', audio: undefined, hls: undefined, url: undefined, videoId: 'dQw4w9WgXcQ', lang: 'en' })!;
    expect(p.src).toBe('dQw4w9WgXcQ');
    expect(p.dir).toBe('ltr');
    expect(episodeUrlOf(p)).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120');
  });
  it('Text: Quelle als src, Passage als context', () => {
    const p = payloadOf({ ...base, form: 'text', audio: undefined, hls: undefined, url: undefined, sourceUrl: 'https://example.org/a', excerpt: 'Satz eins.\nSatz zwei.', lang: 'de' })!;
    expect(p.src).toBe('https://example.org/a');
    expect(p.context).toBe('Satz eins.\nSatz zwei.');
    expect(episodeUrlOf(p)).toBe('https://example.org/a');
  });
  it('ohne Quelle kein Link', () => {
    expect(payloadOf({ ...base, hls: undefined })).toBeNull();
  });
});

describe('share: Text und Link', () => {
  it('Text nur aus dem Moment, kein englisches Etikett, Zeit als m:ss', () => {
    const t = shareText(payloadOf(base)!);
    expect(t).toBe('العين لا تنام\n\nالجملة الأولى. الجملة الثانية.\n\nقناة الطب · الحلقة ٣ · 2:00');
    expect(t).not.toMatch(/channel|episode|at /i);
  });
  it('Link unter dem Basis-Pfad, Hash ist base64url und lässt sich zurücklesen', () => {
    const p = payloadOf(base)!;
    const url = clipUrl(p, 'https://amrsaad.github.io', '/core/preview/');
    expect(url.startsWith('https://amrsaad.github.io/core/preview/clip/#')).toBe(true);
    const hash = url.split('#')[1];
    expect(hash).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodePayload(`#${hash}`)).toEqual(p);
    const b = shareOf(base, 'https://amrsaad.github.io', '/core/')!;
    expect(b.url).toBe(`https://amrsaad.github.io/core/clip/#${encodePayload(p)}`);
    expect(b.title).toBe(p.hook);
  });
  it('fremde oder kaputte Hashes ergeben null', () => {
    expect(decodePayload('')).toBeNull();
    expect(decodePayload('#nicht-base64!')).toBeNull();
    expect(decodePayload(`#${encodePayload({ ...payloadOf(base)!, src: 'javascript:alert(1)' })}`)).toBeNull();
    expect(decodePayload(`#${encodePayload({ ...payloadOf(base)!, v: 2 as 1 })}`)).toBeNull();
  });
});

describe('share: Anzeige im Blatt', () => {
  it('kurz: Host, Pfad, Hash-Anfang', async () => {
    const { shortLink } = await import('../src/share/link');
    expect(shortLink('https://amrsaad.github.io/core/clip/#eyJ2IjoxLCJmb3JtIjoiYXVkaW8i')).toBe('amrsaad.github.io/core/clip/#eyJ2IjoxLCJm…');
    expect(shortLink('https://example.org/x')).toBe('example.org/x');
  });
});
