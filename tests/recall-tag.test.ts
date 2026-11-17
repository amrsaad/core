import { describe, expect, it } from 'vitest';
import { formatReadDay, lastReadDay, recallTag } from '../src/moments/recall';

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

describe('Kennzeichnungszeile der Abrufkarte', () => {
  it('Datum kurz formatiert, ohne führende Null', () => {
    expect(formatReadDay('2026-11-12')).toBe('12 Nov');
    expect(formatReadDay('2026-01-05')).toBe('5 Jan');
  });
  it('ungültiges oder fehlendes Datum ergibt null', () => {
    expect(formatReadDay(null)).toBeNull();
    expect(formatReadDay('')).toBeNull();
    expect(formatReadDay('2026-13-01')).toBeNull();
    expect(formatReadDay('gestern')).toBeNull();
  });
  it('erste Abfrage, Wiederholung und ohne Datum', () => {
    expect(recallTag(false, '2026-11-12')).toBe('Recall · read 12 Nov');
    expect(recallTag(true, '2026-11-12')).toBe('Recall again · read 12 Nov');
    expect(recallTag(false, null)).toBe('Recall');
    expect(recallTag(true, undefined)).toBe('Recall again');
  });
  it('lastReadDay nimmt den jüngsten Logeintrag mit Wiedergabe, sonst momentSeen, sonst null', () => {
    const log = [
      { id: 'a', day: '2026-11-03', ended: true, watched: 20 },
      { id: 'a', day: '2026-11-10', ended: false, watched: 5 },
      { id: 'a', day: '2026-11-12', ended: false, watched: 0 },
      { id: 'b', day: '2026-11-15', ended: true, watched: 9 },
    ];
    expect(lastReadDay(log, {}, 'a', dayOf)).toBe('2026-11-10');
    expect(lastReadDay(log, { c: Date.UTC(2026, 10, 7, 12) }, 'c', dayOf)).toBe('2026-11-07');
    expect(lastReadDay(log, {}, 'c', dayOf)).toBeNull();
  });
});
