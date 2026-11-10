import { describe, expect, it } from 'vitest';
import { b64urlEncode, clipUrl, decodePayload, encodePayload, encodePayloadPlain, episodeUrlOf, linkPayload, packLink, payloadOf, shareOf, shareText, sourceLabel } from '../src/share/link';
import type { Moment } from '../src/moments/types';

// Brief 05 (Entscheidung 27, Issue 21, Issue 52): Text in der Sprache des Tracks, Link mit komprimiertem base64url-JSON (acht Felder, kurze Schlüssel), nichts aus dem Pool im Link.
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
  it('Link unter dem Basis-Pfad, Hash komprimiert ("z") und base64url, trägt nur die acht Felder und lässt sich zurücklesen', async () => {
    const p = payloadOf(base)!;
    const url = await clipUrl(p, 'https://amrsaad.github.io', '/core/preview/');
    expect(url.startsWith('https://amrsaad.github.io/core/preview/clip/#z')).toBe(true);
    const hash = url.split('#')[1];
    expect(hash).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await decodePayload(`#${hash}`)).toEqual(linkPayload(p));
    // Kontext, Kanal, Folge und Folgenseite stehen im Text, nicht im Link
    expect(Object.keys(JSON.parse(packLink(p))).sort()).toEqual(['a', 'b', 'd', 'f', 'h', 'l', 's', 'v']);
    const b = (await shareOf(base, 'https://amrsaad.github.io', '/core/'))!;
    expect(b.url).toBe(`https://amrsaad.github.io/core/clip/#${await encodePayload(p)}`);
    expect(b.title).toBe(p.hook);
    expect(b.text).toContain('قناة الطب');
  });
  it('Issue 52: der Link bleibt kurz, unter 250 Zeichen, mit langer Host-URL unter 350', async () => {
    const short = await clipUrl(payloadOf(base)!, 'https://amrsaad.github.io', '/core/');
    expect(short.length).toBeLessThan(250);
    const longHost = payloadOf({
      ...base,
      // Podcast-CDN mit langer Datei-ID, wie beim ersten echten Share (Audio, Issue 52)
      hls: 'https://audio.podigee-cdn.net/1234567-m-abcdef0123456789abcdef.mp3?source=feed',
      hook: 'Warum die Netzhaut bei Diabetes zuerst in der Peripherie leidet',
      lang: 'de',
    })!;
    const url = await clipUrl(longHost, 'https://amrsaad.github.io', '/core/');
    expect(url.length).toBeLessThan(350);
    // zum Vergleich das alte Format mit allen Feldern: deutlich länger
    const old = `https://amrsaad.github.io/core/clip/#${b64urlEncode(JSON.stringify(longHost))}`;
    expect(old.length).toBeGreaterThan(url.length + 150);
  });
  it('unkomprimierter Fallback ("j") und altes Format (base64url-JSON mit langen Schlüsseln) werden weiter gelesen', async () => {
    const p = payloadOf(base)!;
    const plain = encodePayloadPlain(p);
    expect(plain.startsWith('j')).toBe(true);
    expect(await decodePayload(`#${plain}`)).toEqual(linkPayload(p));
    const legacy = b64urlEncode(JSON.stringify(p));
    expect(legacy.startsWith('ey')).toBe(true);
    // Alte Links tragen Kanal, Folge, Kontext und Folgenseite, die Seite zeigt sie weiter
    expect(await decodePayload(`#${legacy}`)).toEqual(p);
  });
  it('fremde oder kaputte Hashes ergeben null', async () => {
    const p = payloadOf(base)!;
    expect(await decodePayload('')).toBeNull();
    expect(await decodePayload('#nicht-base64!')).toBeNull();
    expect(await decodePayload('#zkaputt')).toBeNull();
    expect(await decodePayload('#jkaputt')).toBeNull();
    expect(await decodePayload(`#${await encodePayload({ ...p, src: 'javascript:alert(1)' })}`)).toBeNull();
    expect(await decodePayload(`#${b64urlEncode(JSON.stringify({ ...p, v: 2 }))}`)).toBeNull();
    expect(await decodePayload(`#j${b64urlEncode(JSON.stringify({ v: 2, f: 'audio', s: p.src, a: 1, b: 2, l: 'de', d: 'ltr', h: 'x' }))}`)).toBeNull();
    expect(await decodePayload(`#${'z'.repeat(9000)}`)).toBeNull();
  });
  it('Kopfzeile der Clip-Seite: Kanal aus alten Links, sonst Host der Quelle oder YouTube', () => {
    const p = payloadOf(base)!;
    expect(sourceLabel(p)).toBe('قناة الطب');
    expect(sourceLabel(linkPayload(p))).toBe('cdn.example.org');
    expect(sourceLabel(linkPayload({ ...p, form: 'video', src: 'dQw4w9WgXcQ' }))).toBe('YouTube');
    expect(episodeUrlOf(linkPayload(p))).toBe('https://cdn.example.org/ep3.mp3#t=120');
  });
});

describe('share: Anzeige im Blatt', () => {
  it('kurz: Host, Pfad, Hash-Anfang', async () => {
    const { shortLink } = await import('../src/share/link');
    expect(shortLink('https://amrsaad.github.io/core/clip/#eyJ2IjoxLCJmb3JtIjoiYXVkaW8i')).toBe('amrsaad.github.io/core/clip/#eyJ2IjoxLCJm…');
    expect(shortLink('https://example.org/x')).toBe('example.org/x');
  });
});
