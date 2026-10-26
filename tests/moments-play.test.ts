import { describe, expect, it } from 'vitest';
import { clampRate, DEFAULT_SETTINGS, DEFAULT_SPEED, HOLD_SPEED, SPEED_OPTIONS, speedOf } from '../src/lib/state';
import { isArabic } from '../src/moments/types';

describe('Wiedergabe Runde 1', () => {
  it('Standardtempo ist 1,5x (Fundament-Regel 11)', () => {
    expect(DEFAULT_SPEED).toBe(1.5);
    expect(DEFAULT_SETTINGS.playbackSpeed).toBe(1.5);
  });
  it('einstellbar 1x und 1,5x, Halten 2x, nie über 2x (Bauliste Punkt 2)', () => {
    expect([...SPEED_OPTIONS]).toEqual([1, 1.5]);
    expect(HOLD_SPEED).toBe(2);
    expect(clampRate(2.5)).toBe(2);
    expect(clampRate(1.5)).toBe(1.5);
    expect(speedOf({ playbackSpeed: 1 })).toBe(1);
    expect(speedOf({ playbackSpeed: 2 })).toBe(1.5);
    expect(speedOf({})).toBe(1.5);
  });
  it('arabische Untertitel werden erkannt, lateinische nicht', () => {
    expect(isArabic('وما من قلب إلا')).toBe(true);
    expect(isArabic('Ali said the Prophet was recovering.')).toBe(false);
    expect(isArabic('Gemischt: قال الإمام')).toBe(true);
  });
});
