import { afterEach, describe, expect, it, vi } from 'vitest';
import { budget, mergeChecked, noteResolveResult, orderChannels, RESOLVE_MAX_FAILS, shouldResolve, streak, type PipeChannel } from '../pipeline/video/limits';
import { isShortCheck, ytGet } from '../pipeline/video/yt';

const ch = (o: Partial<PipeChannel>): PipeChannel => ({ name: 'x', query: 'x', area: 'beat', topic: 't', lang: 'en', channelId: null, ...o });

afterEach(() => vi.unstubAllGlobals());

describe('Video-Pipeline: Zeitgrenzen', () => {
  it('Budget läuft ab', () => {
    let t = 1000;
    const b = budget(500, () => t);
    expect(b.expired()).toBe(false);
    t = 1500;
    expect(b.expired()).toBe(true);
    expect(b.left()).toBe(0);
  });

  it('Kanäle mit ältester Verarbeitung zuerst, nie verarbeitete ganz vorn', () => {
    const l = [ch({ name: 'a', lastRun: '2026-11-24' }), ch({ name: 'b' }), ch({ name: 'c', lastRun: '2026-11-20' }), ch({ name: 'd' })];
    expect(orderChannels(l).map((c) => c.name)).toEqual(['b', 'd', 'c', 'a']);
  });

  it('unklare Antworten in Folge lösen die Bremse aus, ein klares Ergebnis setzt zurück', () => {
    const s = streak(3);
    s.add(true);
    s.add(true);
    s.add(false);
    s.add(true);
    s.add(true);
    expect(s.tripped()).toBe(false);
    s.add(true);
    expect(s.tripped()).toBe(true);
  });

  it('dauerhaft nicht auflösbarer Kanal wird nach N Fehlversuchen nur noch wöchentlich versucht', () => {
    const c = ch({ name: 'Cataract Coach' });
    const t0 = Date.parse('2026-11-24T00:00:00Z');
    for (let i = 0; i < RESOLVE_MAX_FAILS; i++) {
      expect(shouldResolve(c, t0)).toBe(true);
      noteResolveResult(c, false, new Date(t0).toISOString());
    }
    expect(shouldResolve(c, t0 + 86_400_000)).toBe(false);
    expect(shouldResolve(c, t0 + 7 * 86_400_000)).toBe(true);
    noteResolveResult(c, true);
    expect(c.resolveFails).toBeUndefined();
  });

  it('aufgelöster Kanal wird nicht erneut aufgelöst', () => {
    expect(shouldResolve(ch({ channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa' }))).toBe(false);
  });

  it('merkt geprüfte IDs ohne Dopplung und mit Obergrenze', () => {
    expect(mergeChecked(['a', 'b'], ['c', 'a'], 3)).toEqual(['c', 'a', 'b']);
    expect(mergeChecked(undefined, ['a', 'b', 'c', 'd'], 2)).toEqual(['a', 'b']);
  });
});

describe('Video-Pipeline: Abrufe (Mocks, kein Netz)', () => {
  it('nach der Frist wird nichts mehr abgerufen', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const r = await ytGet('https://example.invalid/x', { deadline: Date.now() - 1 });
    expect(r.status).toBe(0);
    expect(f).not.toHaveBeenCalled();
  });

  it('hängender Abruf endet an der Zeitgrenze und wiederholt sich nur tries-mal', async () => {
    const f = vi.fn((_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(new Error('abort')))));
    vi.stubGlobal('fetch', f);
    const t = Date.now();
    const r = await ytGet('https://example.invalid/x', { tries: 1, timeoutMs: 50 });
    expect(r.status).toBe(0);
    expect(Date.now() - t).toBeLessThan(2000);
    expect(f).toHaveBeenCalledTimes(1);
  });

  const res = (status: number) => ({ status, headers: new Headers(), text: async () => '' });

  it('isShortCheck: 200 Short, 303 kein Short, 429 und Fehler unklar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200)));
    expect(await isShortCheck('abcdefghijk')).toBe('short');
    vi.stubGlobal('fetch', vi.fn(async () => res(303)));
    expect(await isShortCheck('abcdefghijk')).toBe('no');
    vi.stubGlobal('fetch', vi.fn(async () => res(429)));
    expect(await isShortCheck('abcdefghijk', { deadline: Date.now() + 1 })).toBe('unknown');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom'); }));
    expect(await isShortCheck('abcdefghijk', { deadline: Date.now() - 1 })).toBe('unknown');
  });
});
