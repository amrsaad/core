import { describe, expect, it } from 'vitest';
import { addTap, CONFIRM_MS, HEART_MS, nextLiked, SWIPE_PX, swipeOf, TAP_MAX, tapStats, TARGET_PT, toastFor } from '../src/moments/actions';

describe('Bedienung (Aufgabe 3)', () => {
  it('Herz 400 ms, Bestätigung am Knopf 150 ms, Ziele 48 pt', () => {
    expect(HEART_MS).toBe(400);
    expect(CONFIRM_MS).toBe(150);
    expect(TARGET_PT).toBe(48);
  });
  it('Toast nur bei Mute und Wrong', () => {
    expect((['more', 'save', 'source', 'known'] as const).some(toastFor)).toBe(false);
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
  // Gleiche Prüfdaten in ios/CoreTests/Round1Tests.swift (testSwipe)
  it('Wischgeste: links öffnet die Rückmeldung, senkrecht blättert, waagerecht gewinnt bei längerem Weg', () => {
    expect(SWIPE_PX).toBe(60);
    expect(swipeOf(-61, 0)).toBe('note');
    expect(swipeOf(-60, 0)).toBeNull();
    expect(swipeOf(-120, 40)).toBe('note');
    expect(swipeOf(-70, -80)).toBe('next');
    expect(swipeOf(0, -61)).toBe('next');
    expect(swipeOf(10, 61)).toBe('prev');
    expect(swipeOf(0, -60)).toBeNull();
    expect(swipeOf(120, 10)).toBeNull();
    expect(swipeOf(-80, -80)).toBe('next');
  });
});
