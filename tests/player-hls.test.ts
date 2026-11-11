// Issue 59, 56, 54: Player-Slot mit eigenem Stream (createPlayer) gegen einen Nachbau von document und <video>.
// Der Nachbau verhält sich wie ein Browser, wo es zählt: pause() und load() lehnen ein ausstehendes play() mit AbortError ab,
// src ist nur mit gesetztem Attribut eine Quelle, Ereignisse kommen nur durch emit.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlayer, deckGesture, deckPrime, audioDeck, registerHls, setDeckForm } from '../src/video/ytApi';

class FakeMedia {
  tagName = 'VIDEO';
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attrs = new Map<string, string>();
  ls: { type: string; f: () => void; once: boolean }[] = [];
  readyState = 0;
  networkState = 0;
  paused = true;
  ended = false;
  currentTime = 0;
  duration = 600;
  muted = true;
  defaultMuted = true;
  playsInline = false;
  preload = '';
  preservesPitch = true;
  crossOrigin: string | null = null;
  defaultPlaybackRate = 1;
  playbackRate = 1;
  error = null;
  textTracks = { length: 0, addEventListener() {} };
  buffered = { length: 0, end: () => 0 };
  playCalls = 0;
  private pending: { rej: (e: unknown) => void } | null = null;
  get src() {
    return this.attrs.get('src') ?? '';
  }
  set src(v: string) {
    this.attrs.set('src', v);
  }
  getAttribute(n: string) {
    return this.attrs.get(n) ?? null;
  }
  setAttribute(n: string, v: string) {
    this.attrs.set(n, v);
  }
  removeAttribute(n: string) {
    this.attrs.delete(n);
  }
  addEventListener(type: string, f: () => void, o?: { once?: boolean }) {
    this.ls.push({ type, f, once: !!o?.once });
  }
  removeEventListener(type: string, f: () => void) {
    this.ls = this.ls.filter((l) => !(l.type === type && l.f === f));
  }
  emit(type: string) {
    for (const l of [...this.ls]) {
      if (l.type !== type) continue;
      if (l.once) this.ls = this.ls.filter((x) => x !== l);
      l.f();
    }
  }
  play() {
    this.playCalls++;
    this.paused = false;
    return new Promise<void>((_res, rej) => {
      this.pending = { rej };
    });
  }
  /** Wie ein Browser: ein ausstehendes play() lehnt mit AbortError ab, wenn pause() oder load() dazwischenkommt */
  private abort() {
    const p = this.pending;
    this.pending = null;
    p?.rej(Object.assign(new Error('The play() request was interrupted'), { name: 'AbortError' }));
  }
  pause() {
    if (!this.paused) {
      this.paused = true;
      this.abort();
    }
  }
  load() {
    this.abort();
    this.paused = true;
    this.readyState = 0;
  }
  /** iOS verwirft ein play() vor den Metadaten still: das Element steht wieder, das Versprechen bleibt offen */
  silentDrop() {
    this.paused = true;
  }
  /** Das play() scheitert von außen (Browser bricht ab) */
  browserAbort() {
    this.paused = true;
    this.abort();
  }
  remove() {}
}

const made: FakeMedia[] = [];
const host = { style: {} as Record<string, string>, kids: [] as FakeMedia[], appendChild(e: FakeMedia) { this.kids.push(e); }, querySelector: () => null };

class StubYT {
  constructor(_el: unknown, o: { events?: { onReady?: () => void } }) {
    setTimeout(() => o.events?.onReady?.(), 0);
  }
  loadVideoById() {}
  cueVideoById() {}
  playVideo() {}
  pauseVideo() {}
  mute() {}
  unMute() {}
  isMuted() { return true; }
  getCurrentTime() { return 0; }
  getDuration() { return 0; }
  getPlayerState() { return -1; }
  setPlaybackRate() {}
  destroy() {}
}
const YT = { Player: StubYT, PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } } as never;

const g = globalThis as unknown as Record<string, unknown>;
const saved: Record<string, unknown> = {};
beforeAll(() => {
  for (const k of ['window', 'document', 'location']) saved[k] = g[k];
});
beforeEach(() => {
  vi.useFakeTimers();
  made.length = 0;
  host.kids = [];
  g.window = globalThis;
  g.location = { origin: 'http://app.test' };
  g.document = {
    visibilityState: 'visible',
    createElement: () => {
      const e = new FakeMedia();
      made.push(e);
      return e;
    },
  };
  registerHls([{ videoId: 'vid-h1', hls: 'https://stream.test/h1.m3u8', form: 'video' }]);
});
afterEach(() => {
  vi.useRealTimers();
  for (const k of ['window', 'document', 'location']) g[k] = saved[k];
});

const mk = (diag: string[]) => createPlayer(YT, { parentElement: host } as never, 'vid-h1', { onDiag: (l) => diag.push(l) });
const flush = async () => {
  await vi.advanceTimersByTimeAsync(0);
};

describe('Slot ohne Quelle spielt nicht (Issue 59, Ziel 5)', () => {
  it('playVideo auf einem noch nicht zugewiesenen Slot ruft play() nicht auf und schreibt keine Zeile', () => {
    const diag: string[] = [];
    const p = mk(diag);
    p.playVideo();
    expect(made.every((m) => m.playCalls === 0)).toBe(true);
    expect(diag.filter((l) => /play#/.test(l))).toEqual([]);
  });
});

describe('Slot hat zu jeder Zeit höchstens ein Element mit Quelle (Issue 59, Ziel 1)', () => {
  it('Cue, Spiel, Cue eines zweiten Moments: nur ein Element mit Quelle je Slot', () => {
    registerHls([{ videoId: 'vid-h2', hls: 'https://stream.test/h2.m3u8', form: 'video' }]);
    const p = mk([]);
    p.cueVideoById({ videoId: 'vid-h1', startSeconds: 10 });
    expect(made.filter((m) => m.getAttribute('src')).length).toBe(1);
    p.loadVideoById({ videoId: 'vid-h2', startSeconds: 5 });
    expect(made.filter((m) => m.getAttribute('src')).length).toBe(1);
    p.destroy();
    expect(made.filter((m) => m.getAttribute('src')).length).toBe(0);
  });
});

describe('AbortError danach kein Bild (Issue 59, Ziel 3)', () => {
  it('Cue, dann Wisch (playVideo), Browser bricht das play() ab: genau ein Wiederholungsstart, in der Diag mit Ursache', async () => {
    const diag: string[] = [];
    const p = mk(diag);
    p.cueVideoById({ videoId: 'vid-h1', startSeconds: 10 });
    const v = made.find((m) => m.getAttribute('src'))!;
    p.playVideo();
    expect(v.playCalls).toBe(1);
    v.browserAbort();
    await flush();
    await vi.advanceTimersByTimeAsync(300);
    expect(v.playCalls).toBe(2);
    expect(diag.some((l) => /aborted by .*retry once/.test(l))).toBe(true);
    // ein zweiter Abbruch bleibt ohne weiteren Versuch
    v.browserAbort();
    await flush();
    await vi.advanceTimersByTimeAsync(600);
    expect(v.playCalls).toBe(2);
  });
  it('eigenes pauseVideo während des ausstehenden play(): kein Wiederholungsstart', async () => {
    const diag: string[] = [];
    const p = mk(diag);
    p.cueVideoById({ videoId: 'vid-h1', startSeconds: 10 });
    const v = made.find((m) => m.getAttribute('src'))!;
    p.playVideo();
    p.pauseVideo();
    await flush();
    await vi.advanceTimersByTimeAsync(600);
    expect(v.playCalls).toBe(1);
    expect(diag.some((l) => /aborted by pauseVideo$/.test(l))).toBe(true);
  });
  it('ein Cue, dem der Wisch danach playVideo gab: ein still verworfenes play() wird bei canplay wiederholt (vorher stand der Slot ohne Bild)', async () => {
    const p = mk([]);
    p.cueVideoById({ videoId: 'vid-h1', startSeconds: 10 });
    const v = made.find((m) => m.getAttribute('src'))!;
    p.playVideo();
    expect(v.playCalls).toBe(1);
    v.silentDrop();
    await vi.advanceTimersByTimeAsync(2000);
    v.readyState = 3;
    v.emit('canplay');
    expect(v.playCalls).toBe(2);
  });
  it('ein Cue ohne playVideo startet bei canplay nicht', async () => {
    const p = mk([]);
    p.cueVideoById({ videoId: 'vid-h1', startSeconds: 10 });
    const v = made.find((m) => m.getAttribute('src'))!;
    v.readyState = 3;
    v.emit('loadedmetadata');
    v.emit('canplay');
    expect(v.playCalls).toBe(0);
  });
});

describe('Audio-Deck nur im Audio-Reiter freischalten (Issue 59, Ziel 1)', () => {
  it('Video-Reiter und Text-Reiter: die Geste ruft unlock und prime nicht', () => {
    const unlock = vi.spyOn(audioDeck, 'unlock').mockImplementation(() => {});
    const prime = vi.spyOn(audioDeck, 'prime').mockImplementation(() => {});
    for (const f of ['video', 'text', null]) {
      setDeckForm(f);
      deckGesture();
      deckPrime();
    }
    expect(unlock).not.toHaveBeenCalled();
    expect(prime).not.toHaveBeenCalled();
    unlock.mockRestore();
    prime.mockRestore();
  });
  it('Audio-Reiter: die Geste ruft unlock', () => {
    const unlock = vi.spyOn(audioDeck, 'unlock').mockImplementation(() => {});
    setDeckForm('audio');
    deckGesture();
    expect(unlock).toHaveBeenCalledTimes(1);
    setDeckForm(null);
    unlock.mockRestore();
  });
});
