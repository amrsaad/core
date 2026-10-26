import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, DEFAULT_SPEED } from '../src/lib/state';
import { isArabic } from '../src/moments/types';

describe('Wiedergabe Runde 1', () => {
  it('Standardtempo ist 1,5x (Fundament-Regel 11)', () => {
    expect(DEFAULT_SPEED).toBe(1.5);
    expect(DEFAULT_SETTINGS.playbackSpeed).toBe(1.5);
  });
  it('arabische Untertitel werden erkannt, lateinische nicht', () => {
    expect(isArabic('وما من قلب إلا')).toBe(true);
    expect(isArabic('Ali said the Prophet was recovering.')).toBe(false);
    expect(isArabic('Gemischt: قال الإمام')).toBe(true);
  });
});
