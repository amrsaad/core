import { describe, expect, it } from 'vitest';
import { clampRate, DEFAULT_RATE, DEFAULT_SETTINGS, emptyState, nextRate, RATES, rateOf } from '../src/lib/state';
import { applyDoc, toDoc } from '../src/lib/sync/merge';
import { isArabic } from '../src/moments/types';

describe('Wiedergabe', () => {
  it('Tempo Pfeiler 17: Standard 1x, Kreis 1x, 1.5x, 2x, 1x, nie über 2x', () => {
    expect(DEFAULT_RATE).toBe(1);
    expect(DEFAULT_SETTINGS.playbackRate).toBe(1);
    expect([...RATES]).toEqual([1, 1.5, 2]);
    expect(nextRate(1)).toBe(1.5);
    expect(nextRate(1.5)).toBe(2);
    expect(nextRate(2)).toBe(1);
    expect(clampRate(2.5)).toBe(2);
    expect(clampRate(1.5)).toBe(1.5);
  });
  it('gespeichertes Tempo: gültige Werte bleiben, alles andere fällt auf 1x', () => {
    expect(rateOf({ playbackRate: 1.5 })).toBe(1.5);
    expect(rateOf({ playbackRate: 2 })).toBe(2);
    expect(rateOf({ playbackRate: 3 as never })).toBe(1);
    expect(rateOf({})).toBe(1);
    // alter Schlüssel playbackSpeed wird nicht gelesen
    expect(rateOf({ playbackSpeed: 1.5 } as never)).toBe(1);
  });
  it('Tempo übersteht Speichern, Neustart und Sync', () => {
    let s = emptyState();
    for (let i = 0; i < 2; i++) s = { ...s, settings: { ...s.settings, playbackRate: nextRate(rateOf(s.settings)) } };
    expect(rateOf(s.settings)).toBe(2);
    const stored = JSON.parse(JSON.stringify(s)) as typeof s;
    expect(rateOf(stored.settings)).toBe(2);
    const doc = toDoc(stored);
    expect(doc.state.settings.playbackRate).toBe(2);
    // anderes Gerät übernimmt den Wert
    const other = applyDoc(emptyState(), { ...doc, ts: { ...doc.ts, 'set:playbackRate': 5 } });
    expect(rateOf(other.settings)).toBe(2);
  });
  it('arabische Untertitel werden erkannt, lateinische nicht', () => {
    expect(isArabic('وما من قلب إلا')).toBe(true);
    expect(isArabic('Ali said the Prophet was recovering.')).toBe(false);
    expect(isArabic('Gemischt: قال الإمام')).toBe(true);
  });
});
