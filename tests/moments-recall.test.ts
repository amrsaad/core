import { describe, expect, it } from 'vitest';
import { answer, cardDue, DAY_MS, isKnown, pickRecall, shuffleOrder, type RecallState } from '../src/moments/recall';

const all = () => true;
const T = 1_800_000_000_000;

describe('Abrufkarte (Runde 1, Punkt 5)', () => {
  it('fest nach jedem 4. Moment', () => {
    expect([1, 2, 3, 4, 5, 8, 12].map(cardDue)).toEqual([false, false, false, true, false, true, true]);
    expect(cardDue(0)).toBe(false);
  });
  it('nimmt den zuletzt gesehenen der letzten 4 mit mindestens 80 %', () => {
    const recent = [
      { id: 'a', watched: 1 },
      { id: 'b', watched: 0.9 },
      { id: 'c', watched: 0.5 },
      { id: 'd', watched: 0.79 },
    ];
    expect(pickRecall({}, recent, T, all)).toEqual({ id: 'b', review: false });
  });
  it('ältere als die letzten 4 zählen nicht, ohne Kandidat keine Karte', () => {
    const recent = [{ id: 'old', watched: 1 }, ...['w', 'x', 'y', 'z'].map((id) => ({ id, watched: 0.2 }))];
    expect(pickRecall({}, recent, T, all)).toBeNull();
  });
  it('schon abgefragte Momente kommen nicht als neue Karte', () => {
    const r = answer({}, 'b', true, T);
    expect(pickRecall(r, [{ id: 'b', watched: 1 }], T, all)).toBeNull();
  });
  it('fällige Wiedervorlage hat Vorrang', () => {
    const r = answer({}, 'old', true, T - 8 * DAY_MS);
    expect(pickRecall(r, [{ id: 'new', watched: 1 }], T, all)).toEqual({ id: 'old', review: true });
    expect(pickRecall(r, [{ id: 'new', watched: 1 }], T, (id) => id !== 'old')).toEqual({ id: 'new', review: false });
  });
  it('Abstände: Treffer 7 Tage, zweiter Treffer 21 Tage, dritter beendet', () => {
    let r: RecallState = answer({}, 'm', true, T);
    expect(r.m.due).toBe(T + 7 * DAY_MS);
    r = answer(r, 'm', true, T + 7 * DAY_MS);
    expect(r.m.due).toBe(T + 28 * DAY_MS);
    r = answer(r, 'm', true, T + 28 * DAY_MS);
    expect(r.m.due).toBeNull();
  });
  it('Fehler: nach 2 Tagen wieder, danach beginnt die Folge neu mit 7 und 21 Tagen', () => {
    let r = answer({}, 'm', false, T);
    expect(r.m.due).toBe(T + 2 * DAY_MS);
    expect(isKnown(r, 'm')).toBe(false);
    r = answer(r, 'm', true, T + 2 * DAY_MS);
    expect(isKnown(r, 'm')).toBe(true);
    expect(r.m.due).toBe(T + 9 * DAY_MS);
    r = answer(r, 'm', false, T + 9 * DAY_MS);
    expect(r.m.due).toBe(T + 11 * DAY_MS);
    r = answer(r, 'm', true, T + 11 * DAY_MS);
    r = answer(r, 'm', true, T + 18 * DAY_MS);
    expect(r.m.due).toBe(T + 39 * DAY_MS);
  });
  it('recallBoost (Core Digest): Treffer nach 4 Tagen, zweiter Treffer nach 14, dritter beendet, Fehler nach 1 Tag', () => {
    let r: RecallState = answer({}, 'm', true, T, true);
    expect(r.m.due).toBe(T + 4 * DAY_MS);
    r = answer(r, 'm', true, T + 4 * DAY_MS, true);
    expect(r.m.due).toBe(T + 18 * DAY_MS);
    r = answer(r, 'm', true, T + 18 * DAY_MS, true);
    expect(r.m.due).toBeNull();
    expect(answer({}, 'x', false, T, true).x.due).toBe(T + 1 * DAY_MS);
    // nach einem Fehler beginnt die Folge neu mit 4 und 14 Tagen
    const miss = answer(answer({}, 'y', true, T, true), 'y', false, T + 1, true);
    expect(answer(miss, 'y', true, T + 2, true).y.due).toBe(T + 2 + 4 * DAY_MS);
  });
  it('ohne recallBoost bleibt es bei 2, 7 und 21 Tagen', () => {
    expect(answer({}, 'a', false, T).a.due).toBe(T + 2 * DAY_MS);
    expect(answer({}, 'b', true, T, false).b.due).toBe(T + 7 * DAY_MS);
    const second = answer(answer({}, 'c', true, T), 'c', true, T + 7 * DAY_MS);
    expect(second.c.due).toBe(T + 28 * DAY_MS);
  });
  it('Momente ohne recall bekommen keine Karte, der nächste Kandidat mit recall rückt nach', () => {
    const has = new Set(['a', 'c']);
    const recent = [{ id: 'a', watched: 1 }, { id: 'b', watched: 1 }, { id: 'c', watched: 0.2 }, { id: 'd', watched: 0.9 }];
    expect(pickRecall({}, recent, T, (id) => has.has(id))).toEqual({ id: 'a', review: false });
    expect(pickRecall({}, recent, T, () => false)).toBeNull();
    const due = answer({}, 'b', false, T - 3 * DAY_MS);
    expect(pickRecall(due, [], T, (id) => has.has(id))).toBeNull();
  });
  it('Antwortreihenfolge: Permutation von 0 bis 2, bei festem Zufall gleich, alle 6 Reihenfolgen möglich', () => {
    const seen = new Set<string>();
    let a = 1;
    const rng = () => ((a = (a * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 300; i++) {
      const o = shuffleOrder(3, rng);
      expect([...o].sort()).toEqual([0, 1, 2]);
      seen.add(o.join());
    }
    expect(seen.size).toBe(6);
    expect(shuffleOrder(3, () => 0)).toEqual(shuffleOrder(3, () => 0));
  });
});
