import { describe, expect, it } from 'vitest';
import { answer, cardDue, DAY_MS, isKnown, pickRecall, type RecallState } from '../src/moments/recall';

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
    const r = answer({}, 'b', true, T, false);
    expect(pickRecall(r, [{ id: 'b', watched: 1 }], T, all)).toBeNull();
  });
  it('fällige Wiedervorlage hat Vorrang', () => {
    const r = answer({}, 'old', true, T - 8 * DAY_MS, false);
    expect(pickRecall(r, [{ id: 'new', watched: 1 }], T, all)).toEqual({ id: 'old', review: true });
    expect(pickRecall(r, [{ id: 'new', watched: 1 }], T, (id) => id !== 'old')).toEqual({ id: 'new', review: false });
  });
  it('Abstände: 7 Tage, gespeichert nach Got it noch 21 Tage, dann fertig', () => {
    let r: RecallState = answer({}, 'm', true, T, true);
    expect(r.m.due).toBe(T + 7 * DAY_MS);
    r = answer(r, 'm', true, T + 7 * DAY_MS, true);
    expect(r.m.due).toBe(T + 28 * DAY_MS);
    r = answer(r, 'm', true, T + 28 * DAY_MS, true);
    expect(r.m.due).toBeNull();
  });
  it('nicht gespeichert: nach Got it in der Wiedervorlage fertig', () => {
    let r = answer({}, 'm', true, T, false);
    r = answer(r, 'm', true, T + 7 * DAY_MS, false);
    expect(r.m.due).toBeNull();
  });
  it('Missed: in 7 Tagen wieder, gekonnt erst nach Got it', () => {
    let r = answer({}, 'm', false, T, false);
    expect(r.m.due).toBe(T + 7 * DAY_MS);
    expect(isKnown(r, 'm')).toBe(false);
    r = answer(r, 'm', true, T + 7 * DAY_MS, true);
    expect(isKnown(r, 'm')).toBe(true);
    expect(r.m.due).toBe(T + 28 * DAY_MS);
  });
});
