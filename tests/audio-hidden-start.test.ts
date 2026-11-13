// Runde 9: Start im Audio-Reiter, kurz danach verdeckt. Der IFrame des Slots wird nie bereit (iOS lädt ihn verdeckt nicht), und die Diag zeigte danach
// weder bei Rückkehr noch bei Tipp noch bei Wisch ein "deck play#". Ursache: createPlayer meldete onReady nur mit dem IFrame, auch für Audio-Momente,
// die den IFrame nicht brauchen. Der Feed ließ einen Slot ohne onReady still aus (assign: !slot.ready), nichts rief je audioDeck.load auf.
// Der Test baut den Ablauf mit einem IFrame, der nie bereit wird: Start, verdeckt, Pool fertig, sichtbar, Tipp, Wisch vor und zurück.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioDeck, createPlayer, registerHls } from '../src/video/ytApi';

class FakeMedia {
  tagName = 'AUDIO';
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  addEventListener() {}
  removeEventListener() {}
  setAttribute() {}
  getAttribute() {
    return null;
  }
  removeAttribute() {}
  pause() {}
  load() {}
  remove() {}
  src = '';
  muted = true;
  paused = true;
  readyState = 0;
  networkState = 0;
  currentTime = 0;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  textTracks = { length: 0, addEventListener() {} };
  buffered = { length: 0, end: () => 0 };
}

const host = { style: {} as Record<string, string>, appendChild() {}, querySelector: () => null };

/** Der IFrame meldet nie onReady (verdeckt gestartet) und hat vor onReady keine Methoden */
let iframeReady: (() => void) | null = null;
class StuckYT {
  constructor(_el: unknown, o: { events?: { onReady?: () => void } }) {
    iframeReady = () => o.events?.onReady?.();
  }
}
const YT = { Player: StuckYT, PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } } as never;

const g = globalThis as unknown as Record<string, unknown>;
const saved: Record<string, unknown> = {};
beforeAll(() => {
  for (const k of ['window', 'document', 'location']) saved[k] = g[k];
});
beforeEach(() => {
  vi.useFakeTimers();
  iframeReady = null;
  g.window = globalThis;
  g.location = { origin: 'http://app.test' };
  g.document = { visibilityState: 'visible', createElement: () => new FakeMedia() };
  registerHls([
    { videoId: 'pod-a', hls: 'https://pod.test/a.mp3', form: 'audio' },
    { videoId: 'pod-b', hls: 'https://pod.test/b.mp3', form: 'audio' },
    { videoId: 'vid-y', hls: undefined, form: 'video' },
  ]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const k of ['window', 'document', 'location']) g[k] = saved[k];
});

const setVis = (v: 'visible' | 'hidden') => {
  (g.document as { visibilityState: string }).visibilityState = v;
};

describe('Audio-Slot ohne bereiten IFrame (Runde 9)', () => {
  it('Start, verdeckt, sichtbar, Tipp, Wisch vor und zurück: jeder Schritt erreicht das Deck, obwohl der IFrame nie bereit wird', async () => {
    const load = vi.spyOn(audioDeck, 'load').mockImplementation(() => {});
    vi.spyOn(audioDeck, 'owns').mockReturnValue(true);
    vi.spyOn(audioDeck, 'holds').mockReturnValue(true);
    const play = vi.spyOn(audioDeck, 'play').mockImplementation(() => {});
    let ready = 0;
    const pa = createPlayer(YT, { parentElement: host } as never, 'pod-a', { onReady: () => ready++ });
    const pb = createPlayer(YT, { parentElement: host } as never, 'pod-b', { onReady: () => {} });
    // Verdeckt, der Pool wird fertig, das Gate läuft ab, 29 s vergehen, wieder sichtbar
    setVis('hidden');
    await vi.advanceTimersByTimeAsync(29_000);
    setVis('visible');
    // Der Feed weist erst zu, wenn onReady kam
    expect(ready).toBe(1);
    pa.loadVideoById({ videoId: 'pod-a', startSeconds: 10, endSeconds: 70 });
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0][2]).toMatchObject({ play: true });
    // Rückkehr und Tipp rufen playVideo, das Deck bekommt sie
    pa.playVideo();
    expect(play).toHaveBeenCalledTimes(1);
    // Wisch vor: der nächste Moment wird geladen, Wisch zurück: wieder der erste
    pa.pauseVideo();
    pb.loadVideoById({ videoId: 'pod-b', startSeconds: 0, endSeconds: 60 });
    expect(load).toHaveBeenCalledTimes(2);
    pb.pauseVideo();
    pa.loadVideoById({ videoId: 'pod-a', startSeconds: 10, endSeconds: 70 });
    expect(load).toHaveBeenCalledTimes(3);
    // Stumm und Ton an vor dem IFrame werfen nicht
    expect(() => {
      pa.mute();
      pa.unMute();
      pa.destroy();
    }).not.toThrow();
  });

  it('ein YouTube-Moment wartet auf den IFrame und lädt erst, wenn er bereit ist', async () => {
    const calls: string[] = [];
    const proto = StuckYT.prototype as unknown as Record<string, unknown>;
    proto.loadVideoById = (a: { videoId: string }) => calls.push(a.videoId);
    proto.pauseVideo = () => {
      throw new Error('IFrame noch nicht bereit');
    };
    const p = createPlayer(YT, { parentElement: host } as never, 'pod-a', { onReady: () => {} });
    p.loadVideoById({ videoId: 'dQw4w9WgXcQ', startSeconds: 0, endSeconds: 10 });
    expect(calls).toEqual([]);
    iframeReady?.();
    expect(calls).toEqual(['dQw4w9WgXcQ']);
    delete proto.loadVideoById;
    delete proto.pauseVideo;
  });

  it('Issue 57: "Slot startbereit" ist nicht "spielbereit": onReady kommt sofort, onState (PLAYING) nur durch echte Wiedergabe', async () => {
    const load = vi.spyOn(audioDeck, 'load').mockImplementation(() => {});
    let ready = 0;
    const states: number[] = [];
    const p = createPlayer(YT, { parentElement: host } as never, 'pod-a', { onReady: () => ready++, onState: (s) => states.push(s) });
    await vi.advanceTimersByTimeAsync(0);
    expect(ready).toBe(1);
    p.loadVideoById({ videoId: 'pod-a', startSeconds: 0, endSeconds: 60 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(load).toHaveBeenCalledTimes(1);
    // Ohne Daten vom Stream kein Zustand, also auch kein played.markReady/set(id, true) im Feed
    expect(states).toEqual([]);
  });
});
