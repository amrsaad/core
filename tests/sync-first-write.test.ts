// Runde 12: der erste Upload nach dem Öffnen wartet auf das erste PLAYING (höchstens 20 s). Downloads bleiben, wie sie sind.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSync, FIRST_WRITE_MAX_MS } from '../src/lib/sync/controller';
import { hasFirstPlayed, markFirstPlay, resetFirstPlay, waitFirstPlay } from '../src/lib/sync/firstPlay';
import { emptyState } from '../src/lib/state';
import { fakeApi } from './sync-fake-api';

const TOKEN = 'ghp_TESTTOKENTESTTOKEN1234';
const key = () => crypto.subtle.importKey('raw', new Uint8Array(32).fill(5), 'AES-GCM', false, ['encrypt', 'decrypt']);
const tick = () => new Promise((r) => setImmediate(r));

describe('Erster Upload wartet auf das erste PLAYING', () => {
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
    vi.setSystemTime(new Date('2026-11-13T10:00:00Z'));
    resetFirstPlay();
  });
  afterEach(() => {
    running.forEach((s) => s.stop());
    running.length = 0;
    vi.useRealTimers();
  });

  function dev(withGate = true) {
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
      firstPlay: withGate ? waitFirstPlay : undefined,
      firstPlayed: hasFirstPlayed,
    });
    running.push(s);
    return { s, api, lines, state: d };
  }

  it('GET läuft sofort, der PUT wartet, bis der erste Moment spielt', async () => {
    const t = dev();
    void t.s.start();
    await advance(100);
    expect(t.api.calls.some((c) => c.method === 'GET')).toBe(true);
    expect(t.api.puts).toBe(0);
    expect(t.lines).toContain('sync: first upload waits for first playback');
    await advance(5_000);
    expect(t.api.puts).toBe(0);
    markFirstPlay();
    await advance(100);
    expect(t.api.puts).toBe(1);
    expect(t.lines.some((l) => /^sync: first upload released \(playing\) after \d+\.\d s$/.test(l))).toBe(true);
  });

  it('spielt nichts, geht der PUT nach 20 s los', async () => {
    const t = dev();
    void t.s.start();
    await advance(100);
    await advance(FIRST_WRITE_MAX_MS - 1_000);
    expect(t.api.puts).toBe(0);
    await advance(1_500);
    expect(t.api.puts).toBe(1);
    expect(t.lines.some((l) => /first upload released \(timeout\) after 20\.\d s/.test(l))).toBe(true);
  });

  it('es wartet nur der erste Upload: der zweite Lauf schreibt sofort', async () => {
    const t = dev();
    void t.s.start();
    await advance(100);
    markFirstPlay();
    await advance(100);
    expect(t.api.puts).toBe(1);
    t.state.state = { ...t.state.state, momentSeen: { ...t.state.state.momentSeen, m2: 1_700_000_100_000 } };
    await t.s.syncNow();
    await advance(100);
    expect(t.api.puts).toBe(2);
    expect(t.lines.filter((l) => l.startsWith('sync: first upload waits')).length).toBe(1);
  });

  it('Verlassen der App und Sync now beenden das Warten sofort', async () => {
    const a = dev();
    void a.s.start();
    await advance(100);
    expect(a.api.puts).toBe(0);
    a.s.visible(false);
    await advance(100);
    expect(a.api.puts).toBe(1);
    const b = dev();
    void b.s.start();
    await advance(100);
    expect(b.api.puts).toBe(0);
    void b.s.syncNow();
    await advance(100);
    expect(b.api.puts).toBe(1);
  });

  it('war schon ein Moment am Spielen, wartet nichts', async () => {
    markFirstPlay();
    expect(hasFirstPlayed()).toBe(true);
    const t = dev();
    await t.s.start();
    await advance(100);
    expect(t.api.puts).toBe(1);
    expect(t.lines.some((l) => /first upload waits/.test(l))).toBe(false);
  });

  it('ohne firstPlay-Abhängigkeit schreibt der Sync wie bisher sofort', async () => {
    const t = dev(false);
    await t.s.start();
    await advance(100);
    expect(t.api.puts).toBe(1);
  });
});
