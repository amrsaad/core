import { describe, expect, it } from 'vitest';
import { errorAction, MAX_RECOVER, resumePos } from '../src/moments/netrecover';

describe('Netzfehler im Slot (Issue 9)', () => {
  const m = { start: 100, end: 160 };

  it('ohne Netz wartet der Slot, er springt nie zum nächsten Moment', () => {
    for (const code of [-1, 5, 3, 0]) expect(errorAction(code, false, 0)).toBe('wait');
    // auch nach vielen Versuchen: ohne Netz zählt nichts, der Slot wartet auf die Rückkehr
    expect(errorAction(-1, false, 9)).toBe('wait');
  });

  it('mit Netz wird an derselben Stelle weitergemacht, erst nach drei Versuchen wird übersprungen', () => {
    for (let t = 0; t < MAX_RECOVER; t++) expect(errorAction(-1, true, t)).toBe('recover');
    expect(errorAction(-1, true, MAX_RECOVER)).toBe('skip');
  });

  it('Inhaltsfehler von YouTube überspringen sofort, auch mit Netz und auch ohne', () => {
    for (const code of [2, 100, 101, 150]) {
      expect(errorAction(code, true, 0)).toBe('skip');
      expect(errorAction(code, false, 0)).toBe('skip');
    }
  });

  it('die Wiederaufnahme setzt an der letzten guten Stelle an, nie vor dem Start und nie am Ende', () => {
    expect(resumePos(130, m)).toBe(130);
    expect(resumePos(0, m)).toBe(100);
    expect(resumePos(-5, m)).toBe(100);
    expect(resumePos(99.9, m)).toBe(100);
    expect(resumePos(160, m)).toBe(159);
    expect(resumePos(999, m)).toBe(159);
    expect(resumePos(NaN, m)).toBe(100);
    // sehr kurzer Moment: nie hinter dem Start
    expect(resumePos(100.5, { start: 100, end: 100.8 })).toBe(100);
  });
});
