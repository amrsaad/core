// Runde 9: ein Audio-Moment startet ohne Wartezeit auf den IFrame, also im selben Zug wie die Geste, die den AudioContext anlegt.
// resume() ist dann noch nicht zurück (suspended). Die Spurwahl fiel in diesem Fenster auf ungeregelt, und der neu gebaute Feed des Reiterwechsels
// holte sie nie nach (sein unlockLevel gehört dem alten Feed). Der Deck hält den ersten Start jetzt kurz, bis der Kontext läuft (deps.settle).
import { describe, expect, it } from 'vitest';
import { AudioDeck, type DeckClip, type DeckEl, type DeckSink } from '../src/video/audioDeck';

class El implements DeckEl {
  src = '';
  currentTime = 0;
  paused = true;
  ended = false;
  readyState = 0;
  duration = 600;
  muted = true;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  private on = new Map<string, (() => void)[]>();
  addEventListener(type: string, fn: () => void) {
    this.on.set(type, [...(this.on.get(type) ?? []), fn]);
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  load() {}
}

const clip: DeckClip = { key: 'a|0|60', id: 'a', url: 'https://stream.test/a.mp3', start: 0, end: 60, gain: -4 };

function setup(settleMs: number | null) {
  let running = false;
  let wake: ((ok: boolean) => void) | null = null;
  const els: (El & { level: boolean })[] = [];
  const deck = new AudioDeck({
    standby: false,
    local: () => undefined,
    dropLocal: () => {},
    make: (lv) => {
      const e = Object.assign(new El(), { level: lv });
      els.push(e);
      return e;
    },
    hidden: () => false,
    running: () => running,
    lane: () => (running ? { lane: 'level', why: 'cors trial' } : { lane: 'plain', why: 'no audio context' }),
    chain: (_el, db) => ({ linear: () => 10 ** (db / 20) }),
    settle: () => (settleMs === null || running ? null : new Promise<boolean>((r) => (wake = r))),
  });
  const sink: DeckSink = { state: () => {}, error: () => {} };
  const lines: string[] = [];
  deck.diag = (l) => lines.push(l);
  return {
    deck,
    sink,
    lines,
    els,
    run: (ok = true) => {
      running = ok;
      wake?.(ok);
    },
  };
}
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

describe('erster Start im Fenster zwischen Geste und laufendem AudioContext (Runde 9)', () => {
  it('ohne Warten wählt der Deck die unveränderte Spur (so war der rote Prüfpunkt)', () => {
    const t = setup(null);
    t.deck.load(clip, t.sink, { play: true, muted: false });
    expect(t.deck.loud(t.sink)?.how).toBe('unchanged: no audio context');
  });

  it('läuft der Kontext binnen der Frist, startet der Moment geregelt, im selben Element der geregelten Spur', async () => {
    const t = setup(400);
    t.deck.load(clip, t.sink, { play: true, muted: false });
    // noch kein Ton, keine Spur gewählt
    expect(t.els.every((e) => e.paused)).toBe(true);
    expect(t.lines.some((l) => l.includes('hold a for audio context'))).toBe(true);
    t.run(true);
    await flush();
    expect(t.deck.loud(t.sink)).toMatchObject({ how: 'web audio', db: -4 });
    expect(t.els.some((e) => e.level && !e.paused)).toBe(true);
  });

  it('läuft der Kontext nicht (Frist um), startet er unverändert, nie gar nicht', async () => {
    const t = setup(400);
    t.deck.load(clip, t.sink, { play: true, muted: false });
    t.run(false);
    await flush();
    expect(t.deck.loud(t.sink)?.how).toBe('unchanged: no audio context');
    expect(t.els.some((e) => !e.level && !e.paused)).toBe(true);
    expect(t.lines.some((l) => l.includes('timeout, unchanged'))).toBe(true);
  });
});
