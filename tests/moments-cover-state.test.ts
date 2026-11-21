// Titelbild: nach Wechsel der Adresse bleibt kein Element mit der alten Adresse stehen, bei Fehler bleibt die Fläche neutral, "online" versucht neu.
import { describe, expect, it } from 'vitest';
import { coverKey, coverStart, coverStep } from '../src/moments/coverState';

describe('Cover-Zustand', () => {
  it('neue Adresse: neuer Zustand mit neuem Schlüssel und neuer Adresse, nie die alte', () => {
    const a = coverStart('https://img.test/a.jpg');
    const b = coverStep(a, { type: 'src', src: 'https://img.test/b.jpg' });
    expect(b.src).toBe('https://img.test/b.jpg');
    expect(coverKey(b)).not.toBe(coverKey(a));
    expect(coverKey(b)).toContain('b.jpg');
    expect(b.bad).toBe(false);
  });

  it('gleiche Adresse: derselbe Zustand (kein Neuaufbau)', () => {
    const a = coverStart('x');
    expect(coverStep(a, { type: 'src', src: 'x' })).toBe(a);
  });

  it('Fehler der alten Adresse blendet das neue Bild nicht aus (Wechsel setzt zurück)', () => {
    const a = coverStep(coverStart('a'), { type: 'error' });
    expect(a.bad).toBe(true);
    const b = coverStep(a, { type: 'src', src: 'b' });
    expect(b.bad).toBe(false);
  });

  it('Ladefehler: neutral (bad), online versucht dieselbe Adresse neu mit neuem Schlüssel, ohne Fehler passiert bei online nichts', () => {
    const a = coverStart('a');
    expect(coverStep(a, { type: 'online' })).toBe(a);
    const e = coverStep(a, { type: 'error' });
    expect(e.bad).toBe(true);
    const r = coverStep(e, { type: 'online' });
    expect(r.bad).toBe(false);
    expect(r.src).toBe('a');
    expect(coverKey(r)).not.toBe(coverKey(a));
  });
});
