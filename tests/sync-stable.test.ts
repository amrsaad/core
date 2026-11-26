// Runde 46 (Gerätelog 26.11.): der erste Upload (rund 270 kB) startete 0,1 s nach dem ersten Ton und löste Stalls nach 4,2 und 8,5 s aus.
// SYNC_AFTER_STABLE: der erste Upload wartet auf 20 s am Stück spielen ohne Stall, oder das Verlassen der App, oder 120 s. Weitere Uploads nicht in den ersten 5 s eines Moments und nicht beim Stocken.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSync, WRITE_DELAY_MS } from '../src/lib/sync/controller';
import {
  hasStablePlayed,
  playGate,
  playGateNow,
  resetFirstPlay,
  setPlayPhase,
  SYNC_AFTER_STABLE,
  SYNC_FIRST_MAX_MS,
  SYNC_PLAY_MIN_MS,
  SYNC_STABLE_MS,
  SYNC_STALL_RECHECK_MS,
  waitStablePlay,
} from '../src/lib/sync/firstPlay';
import { emptyState } from '../src/lib/state';
import { fakeApi } from './sync-fake-api';

const TOKEN = 'ghp_TESTTOKENTESTTOKEN1234';
const key = () => crypto.subtle.importKey('raw', new Uint8Array(32).fill(5), 'AES-GCM', false, ['encrypt', 'decrypt']);
const tick = () => new Promise((r) => setImmediate(r));

describe('playGate (reine Entscheidung)', () => {
  it('Voreinstellung an, 20 s, 120 s, 5 s', () => {
    expect(SYNC_AFTER_STABLE).toBe(true);
    expect([SYNC_STABLE_MS, SYNC_FIRST_MAX_MS, SYNC_PLAY_MIN_MS]).toEqual([20_000, 120_000, 5_000]);
  });
  it('spielt der Moment kürzer als 5 s: Rest der 5 s, danach 0', () => {
    expect(playGate({ phase: 'playing', sinceMs: 0 })).toBe(5000);
    expect(playGate({ phase: 'playing', sinceMs: 1200 })).toBe(3800);
    expect(playGate({ phase: 'playing', sinceMs: 5000 })).toBe(0);
    expect(playGate({ phase: 'playing', sinceMs: 60_000 })).toBe(0);
  });
  it('stockt der Moment: nächste Prüfung nach SYNC_STALL_RECHECK_MS; nichts läuft oder Pause: sofort', () => {
    expect(playGate({ phase: 'stalled', sinceMs: 99_999 })).toBe(SYNC_STALL_RECHECK_MS);
    expect(playGate({ phase: 'idle', sinceMs: 0 })).toBe(0);
  });
});

describe('Sync: erster Upload nach stabilem Spielen', () => {
  const running: { stop(): void; status(): { running: boolean } }[] = [];
  const advance = async (ms: number) => {
    await vi.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < 30; i++) await tick();
    const end = performance.now() + 300;
    while (running.some((x) => x.status().running) && performance.now() < end) await tick();
    for (let i = 0; i < 30; i++) await tick();
  };
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date('2026-11-26T10:00:00Z'));
    resetFirstPlay();
  });
  afterEach(() => {
    running.forEach((s) => s.stop());
    running.length = 0;
    vi.useRealTimers();
  });

  function dev() {
    const api = fakeApi();
    const lines: string[] = [];
    const d = { state: { ...emptyState(), momentSeen: { m1: 1_700_000_000_000 } as Record<string, number> } };
    const s = createSync({
      getState: () => d.state,
      adopt: (fn) => (d.state = fn(d.state)),
      getKey: key,
      getToken: async () => TOKEN,
      fetchImpl: api.fetch,
      now: () => Date.now(),
      log: (l) => lines.push(l),
      firstPlay: waitStablePlay,
      firstPlayed: hasStablePlayed,
      firstWait: { label: 'stable playback', why: 'stable 20 s', maxMs: SYNC_FIRST_MAX_MS },
      playGate: () => playGateNow(),
    });
    running.push(s);
    let i = 0;
    const change = () => {
      d.state = { ...d.state, momentSeen: { ...d.state.momentSeen, [`n${++i}`]: 1_700_000_000_000 + i } };
      s.poke();
    };
    return { s, api, lines, change, state: d };
  }

  it('GET läuft sofort, der PUT wartet auf 20 s am Stück spielen: Zeile "waits for stable playback", dann "released (stable 20 s)"', async () => {
    const t = dev();
    void t.s.start();
    await advance(100);
    expect(t.api.calls.some((c) => c.method === 'GET')).toBe(true);
    expect(t.api.puts).toBe(0);
    expect(t.lines).toContain('sync: first upload waits for stable playback');
    setPlayPhase('playing');
    await advance(SYNC_STABLE_MS - 1000);
    // kein PUT in den ersten 20 s stabiler Wiedergabe, auch nicht 0,1 s nach dem ersten Ton
    expect(t.api.puts).toBe(0);
    await advance(1500);
    expect(t.api.puts).toBe(1);
    expect(t.lines.some((l) => /^sync: first upload released \(stable 20 s\) after \d+\.\d s$/.test(l))).toBe(true);
    expect(t.lines.some((l) => l.includes('released (playing)'))).toBe(false);
  });

  it('ein Stall setzt die 20 s zurück', async () => {
    const t = dev();
    void t.s.start();
    await advance(100);
    setPlayPhase('playing');
    await advance(15_000);
    setPlayPhase('stalled');
    await advance(2_000);
    setPlayPhase('playing');
    await advance(SYNC_STABLE_MS - 1000);
    expect(t.api.puts).toBe(0);
    await advance(1500);
    expect(t.api.puts).toBe(1);
  });

  it('Verlassen der App: sofort, die Zeile nennt "app left"', async () => {
    const t = dev();
    void t.s.start();
    await advance(100);
    setPlayPhase('playing');
    await advance(5_000);
    expect(t.api.puts).toBe(0);
    t.s.visible(false);
    await advance(300);
    expect(t.api.puts).toBe(1);
    expect(t.lines.some((l) => /^sync: first upload released \(app left\) after \d+\.\d s$/.test(l))).toBe(true);
  });

  it('spielt nichts (nie PLAYING): nach 120 s läuft er trotzdem, Zeile "released (timeout)"', async () => {
    const t = dev();
    void t.s.start();
    await advance(100);
    await advance(SYNC_FIRST_MAX_MS - 5_000);
    expect(t.api.puts).toBe(0);
    await advance(6_000);
    expect(t.api.puts).toBe(1);
    expect(t.lines.some((l) => /^sync: first upload released \(timeout\) after 12\d\.\d s$/.test(l))).toBe(true);
  });

  it('der Stand, der nach dem Warten hochgeht, enthält die Änderungen aus der Wartezeit', async () => {
    const t = dev();
    void t.s.start();
    await advance(100);
    setPlayPhase('playing');
    t.change();
    await advance(SYNC_STABLE_MS + 500);
    // genau ein PUT trägt alles (der Stand wird nach dem Warten neu gebildet, kein zweiter Upload für die Änderung aus der Wartezeit)
    expect(t.api.puts).toBe(1);
  });

  it('weitere Uploads: nicht in den ersten 5 s eines Moments, nicht beim Stocken, danach ja', async () => {
    const t = dev();
    // der erste Upload ist durch (stabil gespielt)
    void t.s.start();
    await advance(100);
    setPlayPhase('playing');
    await advance(SYNC_STABLE_MS + 500);
    const base = t.api.puts;
    expect(base).toBe(1);
    // neuer Moment: Laden, dann Spielen. Die Änderung wird fällig (10 s nach der Änderung), während der Moment erst 3 s spielt
    setPlayPhase('idle');
    t.change();
    await advance(WRITE_DELAY_MS - 3_000);
    setPlayPhase('playing');
    await advance(3_000);
    expect(t.api.puts).toBe(base);
    await advance(2_500);
    expect(t.api.puts).toBe(base + 1);
    // Stocken: kein Upload, solange es stockt
    t.change();
    setPlayPhase('stalled');
    await advance(WRITE_DELAY_MS + 3_000);
    expect(t.api.puts).toBe(base + 1);
    setPlayPhase('playing');
    await advance(6_000);
    expect(t.api.puts).toBe(base + 2);
  });

  it('Pause oder nichts läuft: weitere Uploads wie bisher, 10 s nach der Änderung', async () => {
    const t = dev();
    void t.s.start();
    await advance(100);
    setPlayPhase('playing');
    await advance(SYNC_STABLE_MS + 500);
    setPlayPhase('idle');
    const base = t.api.puts;
    t.change();
    await advance(WRITE_DELAY_MS + 200);
    expect(t.api.puts).toBe(base + 1);
  });

  it('der Feed verschwindet (Zustand idle): der Sync wartet nicht auf ihn', () => {
    setPlayPhase('playing');
    setPlayPhase('idle');
    expect(playGateNow()).toBe(0);
  });
});
