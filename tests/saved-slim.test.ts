import { describe, expect, it } from 'vitest';
import { newSaved, resolveSaved, savedView, slimSaved, stubOf } from '../src/moments/saved';
import { buildAliasIndex, migrateDoc } from '../src/moments/aliases';
import { combineSaved, emptyDoc, toDoc, type SyncDoc } from '../src/lib/sync/merge';
import { emptyState, type SavedMoment } from '../src/lib/state';
import type { Moment } from '../src/moments/types';

const mo = (id: string, extra: Partial<Moment> = {}): Moment => ({
  id,
  videoId: 'dQw4w9WgXcQ',
  start: 612.4,
  end: 658.9,
  channel: 'Huberman Lab',
  videoTitle: 'How to build muscle and lose fat, with a long episode title attached',
  area: 'body',
  topic: 'training',
  hook: 'Train each muscle about twice a week, because volume spread over more days beats one long session',
  forYou: 'x'.repeat(200),
  context: 'c'.repeat(300),
  kind: 'regel',
  form: 'video',
  createdAt: '2026-10-20T00:00:00Z',
  excerpt: 'e'.repeat(500),
  cues: Array.from({ length: 12 }, (_, i) => [i, 'cue text for this line'] as [number, string]),
  ...extra,
});
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
const pool = (...ms: Moment[]) => new Map(ms.map((m) => [m.id, m]));
const AT = '2026-10-25T10:00:00.000Z';

describe('neuer Eintrag', () => {
  it('belegt höchstens 400 Byte, ohne moment', () => {
    const e = newSaved(mo('a:1'), AT);
    const n = bytes(e);
    console.log(`neuer Eintrag: ${n} Byte, Altformat: ${bytes({ moment: mo('a:1'), savedAt: AT })} Byte`);
    expect(n).toBeLessThanOrEqual(400);
    expect(e.moment).toBeUndefined();
    expect(e.stub?.id).toBe('a:1');
  });
  it('bleibt auch mit langen Texten und langer URL unter 400 Byte', () => {
    const m = mo('a:1', { hook: 'h'.repeat(400), channel: 'c'.repeat(100), videoTitle: 't'.repeat(300), url: `https://example.org/${'p'.repeat(300)}` });
    const e = newSaved(m, AT);
    expect(bytes(e)).toBeLessThanOrEqual(400);
    expect(e.stub?.url).toBeUndefined();
  });
});

describe('resolveSaved', () => {
  const m = mo('a:1');
  it('Pool zuerst', () => {
    const pm = mo('a:1', { start: 700 });
    expect(resolveSaved({ moment: m, savedAt: AT }, 'a:1', pool(pm))).toBe(pm);
  });
  it('sonst Altformat', () => expect(resolveSaved({ moment: m, savedAt: AT }, 'a:1', pool())).toBe(m));
  it('sonst null, auch bei fehlendem Eintrag', () => {
    expect(resolveSaved(newSaved(m, AT), 'a:1', pool())).toBeNull();
    expect(resolveSaved(undefined, 'a:1', pool())).toBeNull();
    expect(resolveSaved({ savedAt: AT }, 'a:1', pool())).toBeNull();
  });
  it('Liste: Hook, Kanal, Titel und Link kommen bei null aus dem stub, ein Eintrag ohne alles stürzt nicht ab', () => {
    const v = savedView(newSaved(mo('a:1', { url: 'https://example.org/x' }), AT), 'a:1', pool());
    expect(v).toMatchObject({ moment: null, channel: 'Huberman Lab', url: 'https://example.org/x', area: 'body' });
    expect(v.hook.startsWith('Train each muscle')).toBe(true);
    expect(savedView({ savedAt: AT }, 'z', pool())).toMatchObject({ moment: null, hook: '', channel: '', url: undefined });
  });
});

describe('slimSaved', () => {
  const a = mo('a:1');
  const b = mo('b:2');
  const saved = (): Record<string, SavedMoment> => ({ 'a:1': { moment: a, savedAt: AT, done: true }, 'b:2': { moment: b, savedAt: AT } });
  it('ersetzt moment durch stub nur bei Pool-Treffern, der Rest bleibt unverändert', () => {
    const s = saved();
    const out = slimSaved(s, pool(a));
    expect(out['a:1'].moment).toBeUndefined();
    expect(out['a:1'].stub).toEqual(stubOf(a));
    expect(out['a:1'].done).toBe(true);
    expect(out['b:2']).toBe(s['b:2']);
    expect(out['b:2'].moment).toBe(b);
    expect(bytes(out['a:1'])).toBeLessThanOrEqual(420);
  });
  it('ist idempotent und gibt ohne Änderung denselben Verweis zurück', () => {
    const once = slimSaved(saved(), pool(a, b));
    expect(slimSaved(once, pool(a, b))).toBe(once);
    const s = saved();
    expect(slimSaved(s, pool())).toBe(s);
    expect(slimSaved(s, pool(mo('c:3')))).toBe(s);
  });
  it('lässt neue Einträge und Einträge ohne alles unberührt', () => {
    const s: Record<string, SavedMoment> = { 'a:1': newSaved(a, AT), x: { savedAt: AT } };
    expect(slimSaved(s, pool(a))).toBe(s);
  });
});

describe('combineSaved Mischformen', () => {
  const m1 = mo('a:1');
  const m2 = mo('a:1', { createdAt: '2026-10-22T00:00:00Z' });
  const oldA: SavedMoment = { moment: m1, savedAt: '2026-10-25T10:00:00.000Z' };
  const oldB: SavedMoment = { moment: m2, savedAt: '2026-10-24T10:00:00.000Z', done: true };
  const newA: SavedMoment = newSaved(m1, '2026-10-26T10:00:00.000Z');
  const newB: SavedMoment = { stub: { ...stubOf(m1), hook: 'Another hook that is a bit longer than the first one' }, savedAt: '2026-10-23T10:00:00.000Z' };
  const all = [oldA, oldB, newA, newB];
  it('kommutativ und idempotent für alle Paare', () => {
    for (const x of all) {
      expect(combineSaved(x, x)).toEqual(x);
      for (const y of all) {
        expect(combineSaved(x, y)).toEqual(combineSaved(y, x));
        const c = combineSaved(x, y);
        expect(combineSaved(c, c)).toEqual(c);
        expect(combineSaved(c, x)).toEqual(c);
        expect(combineSaved(c, y)).toEqual(c);
      }
    }
  });
  it('savedAt das frühere, done ODER, moment bleibt bei Mischform, stub deterministisch', () => {
    const c = combineSaved(oldA, newB);
    expect(c.moment).toBe(m1);
    expect(c.stub).toBe(newB.stub);
    expect(c.savedAt).toBe('2026-10-23T10:00:00.000Z');
    expect(combineSaved(oldB, newA).done).toBe(true);
    expect(combineSaved(newA, newB).stub).toBe(newA.stub);
    expect(combineSaved(newA, newB).moment).toBeUndefined();
    expect(combineSaved(oldA, oldB).moment).toBe(m2);
  });
});

describe('migrateDoc mit stub', () => {
  const OLD = 'pod-x:614.5';
  const NEW = 'pod-x:586.49';
  const fresh = mo(NEW, { aliases: [OLD] });
  const idx = buildAliasIndex([fresh]);
  const docWith = (saved: Record<string, SavedMoment>): SyncDoc => {
    const d = toDoc({ ...emptyState(), savedMoments: saved });
    return { ...d, ts: { [`saved:${OLD}`]: 5000 } };
  };
  it('zieht die ID im stub bei umbenanntem Eintrag mit', () => {
    const d = migrateDoc(docWith({ [OLD]: newSaved(mo(OLD), AT) }), idx);
    expect(Object.keys(d.state.savedMoments)).toEqual([NEW]);
    expect(d.state.savedMoments[NEW].stub?.id).toBe(NEW);
    expect(d.state.savedMoments[NEW].moment).toBeUndefined();
    expect(d.ts[`saved:${NEW}`]).toBe(5000);
  });
  it('Eintrag nur mit stub oder ohne alles stürzt nicht ab, Altformat bekommt weiter das Pool-Abbild', () => {
    const d = migrateDoc(docWith({ [OLD]: { moment: mo(OLD), savedAt: AT }, 'k:1': { savedAt: AT } }), idx);
    expect(d.state.savedMoments[NEW].moment).toBe(fresh);
    expect(d.state.savedMoments['k:1']).toEqual({ savedAt: AT });
    const e = emptyDoc();
    expect(migrateDoc(e, idx)).toBe(e);
  });
});
