// Runde 18 (Diag 16.11., Mobilfunk): der Sync lud mehrfach je Minute 190 kB hoch und nahm dem Ton die Bandbreite.
// Sichtbar höchstens ein Upload je 60 s, keiner, solange ein Moment lädt. Verdeckt, Sync now: sofort.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSync, UPLOAD_BUSY_RECHECK_MS, UPLOAD_GAP_MS, WRITE_DELAY_MS } from '../src/lib/sync/controller';
import { emptyState } from '../src/lib/state';
import { fakeApi } from './sync-fake-api';

const TOKEN = 'ghp_TESTTOKENTESTTOKEN1234';
const key = () => crypto.subtle.importKey('raw', new Uint8Array(32).fill(5), 'AES-GCM', false, ['encrypt', 'decrypt']);
const tick = () => new Promise((r) => setImmediate(r));

describe('Sync: Drossel der Uploads', () => {
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
    vi.setSystemTime(new Date('2026-11-16T10:00:00Z'));
  });
  afterEach(() => {
    running.forEach((s) => s.stop());
    running.length = 0;
    vi.useRealTimers();
  });

  function dev(busy: () => boolean = () => false) {
    const api = fakeApi();
    const d = { state: { ...emptyState(), momentSeen: { m0: 1_700_000_000_000 } as Record<string, number> } };
    const s = createSync({
      getState: () => d.state,
      adopt: (fn) => (d.state = fn(d.state)),
      getKey: key,
      getToken: async () => TOKEN,
      fetchImpl: api.fetch,
      now: () => Date.now(),
      log: () => {},
      uploadBusy: () => busy(),
    });
    running.push(s);
    let i = 0;
    const change = () => {
      d.state = { ...d.state, momentSeen: { ...d.state.momentSeen, [`m${++i}`]: 1_700_000_000_000 + i } };
      s.poke();
    };
    const gets = () => api.calls.filter((c) => c.method === 'GET').length;
    return { s, api, change, gets };
  }

  it('sichtbar: der zweite Upload kommt frühestens UPLOAD_GAP_MS nach dem ersten', async () => {
    const t = dev();
    t.change();
    await advance(WRITE_DELAY_MS + 100);
    expect(t.api.puts).toBe(1);
    t.change();
    await advance(WRITE_DELAY_MS + 100);
    expect(t.api.puts).toBe(1);
    await advance(30_000);
    expect(t.api.puts).toBe(1);
    await advance(UPLOAD_GAP_MS);
    expect(t.api.puts).toBe(2);
  });

  it('das Warten kostet keine Downloads', async () => {
    const t = dev();
    t.change();
    await advance(WRITE_DELAY_MS + 100);
    expect(t.api.puts).toBe(1);
    const g = t.gets();
    t.change();
    await advance(UPLOAD_GAP_MS - 20_000);
    expect(t.gets()).toBe(g);
    expect(t.api.puts).toBe(1);
  });

  it('Verlassen der App schreibt sofort, was wartet', async () => {
    const t = dev();
    t.change();
    await advance(WRITE_DELAY_MS + 100);
    t.change();
    await advance(WRITE_DELAY_MS + 100);
    expect(t.api.puts).toBe(1);
    t.s.visible(false);
    await advance(200);
    expect(t.api.puts).toBe(2);
  });

  it('Sync now schreibt sofort', async () => {
    const t = dev();
    t.change();
    await advance(WRITE_DELAY_MS + 100);
    t.change();
    await t.s.syncNow();
    await advance(200);
    expect(t.api.puts).toBe(2);
  });

  it('lädt ein Moment (uploadBusy), startet kein Upload. Danach geht es nach der Rückmeldung los', async () => {
    let busy = true;
    const t = dev(() => busy);
    t.change();
    await advance(WRITE_DELAY_MS + 100);
    expect(t.api.puts).toBe(0);
    await advance(30_000);
    expect(t.api.puts).toBe(0);
    busy = false;
    await advance(UPLOAD_BUSY_RECHECK_MS + 100);
    expect(t.api.puts).toBe(1);
  });

  it('lädt ein Moment und die App wird verlassen: sofort schreiben, nichts geht verloren', async () => {
    const t = dev(() => true);
    t.change();
    await advance(WRITE_DELAY_MS + 100);
    expect(t.api.puts).toBe(0);
    t.s.visible(false);
    await advance(200);
    expect(t.api.puts).toBe(1);
  });
});
