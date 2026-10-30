import { describe, expect, it } from 'vitest';
import { isReserved, sourceLine } from '../src/moments/source';

// Gleiche Prüfdaten in ios/CoreTests/Round1Tests.swift (testSourceLine)
const RES = 'Alle Rechte vorbehalten, frei lesbar. Private Nutzung, Passagen mit Quellenangabe';

describe('Quellenzeile (Aufgabe 6)', () => {
  it('offene Lizenz: Autor, Quelle, Fundstelle, Lizenz, Link', () => {
    expect(sourceLine({ author: 'Jane Roe', channel: 'Europe PMC', ref: 'PMC123', license: 'CC BY 4.0', sourceUrl: 'https://example.org/a' })).toEqual({
      prefix: '', text: 'Jane Roe, Europe PMC, PMC123, CC BY 4.0', url: 'https://example.org/a',
    });
  });
  it('vorbehaltene Rechte: Quoted from vor dem Namen, kurze Lizenzangabe', () => {
    expect(sourceLine({ author: 'Jordan Feigenbaum', channel: 'Barbell Medicine', license: RES, sourceUrl: 'https://www.barbellmedicine.com/x/' })).toEqual({
      prefix: 'Quoted from ', text: 'Jordan Feigenbaum, Barbell Medicine, All rights reserved', url: 'https://www.barbellmedicine.com/x/',
    });
    expect(isReserved('All rights reserved')).toBe(true);
    expect(isReserved('CC BY 4.0')).toBe(false);
    expect(isReserved(undefined)).toBe(false);
  });
  it('ohne Autor beginnt die Zeile mit der Quelle, gleiche Namen werden nicht doppelt genannt', () => {
    expect(sourceLine({ channel: 'Quran.com', ref: 'Quran 94:5', license: 'CC BY 4.0' })?.text).toBe('Quran.com, Quran 94:5, CC BY 4.0');
    expect(sourceLine({ author: 'Quran.com', channel: 'Quran.com', license: 'CC BY 4.0' })?.text).toBe('Quran.com, CC BY 4.0');
  });
  it('ohne Link oder mit ungültigem Link nicht antippbar, ohne Angaben keine Zeile', () => {
    expect(sourceLine({ author: 'A', channel: '', license: 'CC BY 4.0' })?.url).toBeNull();
    expect(sourceLine({ author: 'A', channel: '', license: 'CC BY 4.0', sourceUrl: 'javascript:alert(1)' })?.url).toBeNull();
    expect(sourceLine({ channel: '' })).toBeNull();
  });
});
