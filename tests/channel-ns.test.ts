// Kanal-Trennung (Entscheidung 56, Brief 21): Hauptkanal behält jeden Namen, Vorschau bekommt überall eigene Namen.
import { afterEach, describe, expect, it, vi } from 'vitest';

async function load(base: string) {
  vi.resetModules();
  vi.stubEnv('BASE_URL', base);
  const ns = await import('../src/lib/ns');
  const queue = await import('../src/moments/queue');
  const head = await import('../src/moments/startHead');
  const pre = await import('../src/moments/preloader');
  const focus = await import('../src/moments/focus');
  const state = await import('../src/lib/state');
  const gh = await import('../src/lib/sync/github');
  return { ns, queue, head, pre, focus, state, gh };
}

afterEach(() => vi.unstubAllEnvs());

describe('Hauptkanal /core/: alle Namen exakt wie vor Brief 21', () => {
  it('localStorage, Cache Storage, IndexedDB und Remote-Datei', async () => {
    const m = await load('/core/');
    expect(m.ns.CHANNEL).toBe('prod');
    expect(m.ns.IS_PREVIEW).toBe(false);
    expect(m.queue.queueKey('video')).toBe('core.queue.v1.video');
    expect(m.head.headsKey('audio')).toBe('core.heads.v1.audio');
    expect(m.head.COLD_KEY).toBe('core.coldnet.v1');
    expect(m.state.REPAIR45_KEY).toBe('core.repair45.v1');
    expect(m.pre.CACHE_NAME).toBe('core-preload-v1');
    expect(m.focus.FOCUS_KEY).toBe('core-focus');
    expect(m.ns.lsKey('preload.v1')).toBe('core.preload.v1');
    expect(m.ns.lsKey('saved.view')).toBe('core.saved.view');
    expect(m.ns.lsKey('level.on')).toBe('core.level.on');
    expect(m.ns.lsKey('level.cors')).toBe('core.level.cors');
    expect(m.ns.lsKey('device.v1')).toBe('core.device.v1');
    for (const n of ['core', 'core-key', 'core-token']) expect(m.ns.dashName(n)).toBe(n);
    expect(m.gh.STATE_PATH).toBe('state/core-state.enc');
    expect(m.gh.DIGEST_PATH).toBe('state/digest-latest.enc');
  });
});

describe('Vorschau /core/preview/: eigene Namen, nichts aus der echten App', () => {
  it('jeder Name unterscheidet sich vom Hauptkanal', async () => {
    const p = await load('/core/preview/');
    expect(p.ns.CHANNEL).toBe('preview');
    expect(p.ns.IS_PREVIEW).toBe(true);
    expect(p.queue.queueKey('video')).toBe('corepv.queue.v1.video');
    expect(p.head.headsKey('audio')).toBe('corepv.heads.v1.audio');
    expect(p.head.COLD_KEY).toBe('corepv.coldnet.v1');
    expect(p.state.REPAIR45_KEY).toBe('corepv.repair45.v1');
    expect(p.pre.CACHE_NAME).toBe('core-preload-v1-pv');
    expect(p.focus.FOCUS_KEY).toBe('core-focus-pv');
    expect(p.ns.dashName('core')).toBe('core-pv');
    expect(p.ns.dashName('core-key')).toBe('core-key-pv');
    expect(p.ns.dashName('core-token')).toBe('core-token-pv');
    expect(p.gh.STATE_PATH).toBe('state/core-state-preview.enc');
    // Die Wochenkarte wird nur gelesen und bleibt gemeinsam
    expect(p.gh.DIGEST_PATH).toBe('state/digest-latest.enc');
  });

  it('kein localStorage-Schlüssel der Vorschau beginnt mit dem Präfix der echten App', async () => {
    const p = await load('/core/preview/');
    const keys = [p.queue.queueKey('text'), p.head.headsKey('text'), p.head.COLD_KEY, p.state.REPAIR45_KEY, p.ns.lsKey('preload.v1'), p.ns.lsKey('saved.view'), p.ns.lsKey('level.on'), p.ns.lsKey('device.v1')];
    for (const k of keys) expect(k.startsWith('core.')).toBe(false);
  });
});
