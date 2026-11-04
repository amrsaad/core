// Brief 11, Schritt 9: Vorrat-Tiefe, mindestens 3 der nächsten 6 Momente liegen im Vorrat
import { describe, expect, it } from 'vitest';
import { depthPlan } from '../src/moments/lockScreen';

const q = (ids: string) => ids.split('').map((id) => ({ id }));
const held = (ids: string) => (m: { id: string }) => ids.includes(m.id);
const ids = (r: { queue: { id: string }[] }) => r.queue.map((m) => m.id).join('');

describe('depthPlan', () => {
  it('lässt die Reihenfolge, wenn schon 3 von 6 im Vorrat liegen', () => {
    const r = depthPlan(q('0abcdefgh'), 0, held('ace'), 3, 6);
    expect(ids(r)).toBe('0abcdefgh');
    expect(r.moved).toBe(0);
    expect(r.have).toBe(3);
  });

  it('zieht Vorrats-Momente von weiter hinten auf die ersten Plätze ohne Vorrat ab idx+2', () => {
    // nächste 6: a b c d e f (kein Vorrat), dahinter g h i j mit Vorrat
    const r = depthPlan(q('0abcdefghij'), 0, held('ghij'), 3, 6);
    expect(r.moved).toBe(3);
    expect(r.have).toBe(3);
    // idx+1 bleibt, dann tauschen g, h, i auf die Plätze 2, 3, 4, die verdrängten Momente nehmen deren Plätze
    expect(ids(r).slice(0, 2)).toBe('0a');
    expect(['g', 'h', 'i'].every((c) => ids(r).slice(2, 5).includes(c))).toBe(true);
    expect(ids(r).length).toBe(11);
    expect([...ids(r)].sort().join('')).toBe([...'0abcdefghij'].sort().join(''));
  });

  it('idx+1 bleibt auch dann, wenn dort kein Vorrat liegt (dort entscheidet die Wahl des Nachfolgers)', () => {
    const r = depthPlan(q('0abcdefgh'), 0, held('fgh'), 3, 6);
    expect(ids(r)[1]).toBe('a');
    expect(r.have).toBe(3);
  });

  it('ein Vorrats-Moment verlässt das Fenster nie nach hinten', () => {
    const r = depthPlan(q('0abcdefghi'), 0, held('bfgh'), 3, 6);
    const win = ids(r).slice(1, 7);
    expect(['b', 'f'].every((c) => win.includes(c))).toBe(true);
    expect(r.have).toBeGreaterThanOrEqual(3);
  });

  it('gibt auf, wenn nicht genug Vorrat da ist, und meldet den Stand', () => {
    const r = depthPlan(q('0abcdefgh'), 0, held('h'), 3, 6);
    expect(r.have).toBe(1);
    expect(r.moved).toBe(1);
    const none = depthPlan(q('0abcdefgh'), 0, held(''), 3, 6);
    expect(none.have).toBe(0);
    expect(ids(none)).toBe('0abcdefgh');
  });

  it('zählt ab idx+1 und kommt mit kurzer Warteschlange zurecht', () => {
    expect(depthPlan(q('01'), 1, held(''), 3, 6).have).toBe(0);
    expect(depthPlan([], 0, held('a'), 3, 6).queue).toEqual([]);
    const r = depthPlan(q('xx0abc'), 2, held('c'), 3, 6);
    expect(r.have).toBe(1);
    expect(ids(r)).toBe('xx0abc');
  });
});
