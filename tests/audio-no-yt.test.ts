// Runde 46 (AUDIO_NO_YT): im Audio-Reiter wird die YouTube-API nicht geladen und kein IFrame angelegt, solange alle Audio-Momente mp3 oder Stream sind.
import { describe, expect, it } from 'vitest';
import { AUDIO_NO_YT, audioNoYt } from '../src/moments/neighborGate';
import { lazyYT } from '../src/video/ytApi';

const mp3 = { form: 'audio' as const, hls: 'https://pod.test/a.mp3', videoId: 'a1' };
const stream = { form: 'audio' as const, hls: 'https://stream.test/a.m3u8', videoId: 'a2' };
const yt = { form: 'audio' as const, hls: undefined, videoId: 'abcdefghijk' };
const video = { form: 'video' as const, hls: undefined, videoId: 'abcdefghijk' };

describe('audioNoYt', () => {
  it('Voreinstellung an', () => {
    expect(AUDIO_NO_YT).toBe(true);
  });
  it('Audio-Reiter mit reiner mp3- und Stream-Warteschlange: kein YouTube', () => {
    expect(audioNoYt('audio', [mp3, stream])).toBe(true);
    expect(audioNoYt('audio', [])).toBe(true);
  });
  it('ein Audio-Moment mit YouTube-Quelle: es bleibt beim Verhalten von Runde 45', () => {
    expect(audioNoYt('audio', [mp3, yt])).toBe(false);
  });
  it('Video- und Text-Reiter sind unberührt', () => {
    expect(audioNoYt('video', [video])).toBe(false);
    expect(audioNoYt('text', [])).toBe(false);
    expect(audioNoYt(undefined, [mp3])).toBe(false);
  });
  it('Schalter aus: nie', () => {
    expect(audioNoYt('audio', [mp3], false)).toBe(false);
  });
});

describe('lazyYT(false)', () => {
  it('der Platzhalter lädt nie die API und legt nie einen Player an', () => {
    const g = globalThis as unknown as { window?: unknown; document?: unknown };
    const before = { w: g.window, d: g.document };
    // ohne window und document: ein Zugriff darauf würde werfen
    const YT = lazyYT(false);
    const p = new (YT.Player as unknown as new (el: unknown, o: Record<string, unknown>) => { getPlayerState(): number; playVideo(): void })({}, {});
    expect(p.getPlayerState()).toBe(-1);
    expect(() => p.playVideo()).not.toThrow();
    expect(g.window).toBe(before.w);
    expect(g.document).toBe(before.d);
  });
});
