import { describe, expect, it } from 'vitest';
import { focusTabText, remainingText } from '../src/components/head';

const NOW = Date.UTC(2026, 10, 4, 12, 0, 0);

describe('Kopfzeile: Zusatz am Reiter bei aktivem Fokus', () => {
  it('Restzeit in Minuten, ab 2 Stunden in Stunden, Sitzung als session', () => {
    expect(remainingText(NOW + 52 * 60_000, NOW)).toBe('52 min');
    expect(remainingText(NOW + 30_000, NOW)).toBe('1 min');
    expect(remainingText(NOW + 150 * 60_000, NOW)).toBe('2 h');
    expect(remainingText('session', NOW)).toBe('session');
  });
  it('Sprache und Restzeit wie im Board: English · 52 min', () => {
    expect(focusTabText({ areas: [], langs: ['en'], until: NOW + 52 * 60_000 }, NOW)).toBe('English · 52 min');
  });
  it('Bereiche vor Sprachen in fester Reihenfolge', () => {
    expect(focusTabText({ areas: ['brain', 'beat'], langs: ['en', 'ar'], until: 'session' }, NOW)).toBe('Beat · Brain · Arabic · English · session');
  });
});
