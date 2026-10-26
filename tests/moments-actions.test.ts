import { describe, expect, it } from 'vitest';
import { addTap, CONFIRM_MS, HEART_MS, nextLiked, TAP_MAX, tapStats, TARGET_PT, toastFor } from '../src/moments/actions';

describe('Bedienung (Aufgabe 3)', () => {
  it('Herz 400 ms, Bestätigung am Knopf 150 ms, Ziele 48 pt', () => {
    expect(HEART_MS).toBe(400);
    expect(CONFIRM_MS).toBe(150);
    expect(TARGET_PT).toBe(48);
  });
  it('Toast nur bei Mute und Wrong', () => {
    expect((['more', 'save', 'source', 'known', 'weak', 'captions'] as const).some(toastFor)).toBe(false);
    expect(toastFor('mute') && toastFor('wrong')).toBe(true);
  });
  it('Doppeltipp setzt nur, der Knopf schaltet um', () => {
    expect(nextLiked(false, 'double')).toBe(true);
    expect(nextLiked(true, 'double')).toBe(true);
    expect(nextLiked(false, 'button')).toBe(true);
    expect(nextLiked(true, 'button')).toBe(false);
  });
  it('Reaktionszeit: Median, 90 %, Anteil unter 100 ms', () => {
    expect(tapStats(undefined).n).toBe(0);
    let l = addTap(undefined, { ms: 20, at: 1 });
    for (const ms of [30, 40, 50, 150]) l = addTap(l, { ms, at: 2 });
    const x = tapStats(l);
    expect(x).toMatchObject({ n: 5, median: 40, p90: 150, underTarget: 0.8 });
  });
  it('Liste bleibt begrenzt', () => {
    let l = undefined as ReturnType<typeof addTap> | undefined;
    for (let i = 0; i < TAP_MAX + 10; i++) l = addTap(l, { ms: i, at: i });
    expect(l?.length).toBe(TAP_MAX);
    expect(l?.[0].ms).toBe(10);
  });
});
