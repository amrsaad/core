import { describe, expect, it } from 'vitest';
import { closesSheet, SHEET_SWIPE_PX } from '../src/components/sheetClose';
import { CAPTION_SWIPE_PX, closesCaption } from '../src/moments/hook';

// Brief 17, Issue 39, Entscheidung 54: alle Blätter schließen gleich per Wisch nach unten ab 80 px, nur wenn der Inhalt oben steht.
describe('Blätter schließen per Wisch', () => {
  it('schließt ab 80 px nach unten', () => {
    expect(SHEET_SWIPE_PX).toBe(80);
    expect(closesSheet(80, 0)).toBe(true);
    expect(closesSheet(79, 0)).toBe(false);
    expect(closesSheet(200, 0)).toBe(true);
  });
  it('schließt nicht bei Wisch nach oben oder gescrolltem Inhalt', () => {
    expect(closesSheet(-120, 0)).toBe(false);
    expect(closesSheet(120, 40)).toBe(false);
  });
  it('Kontext-Blatt nutzt dieselbe Regel', () => {
    expect(CAPTION_SWIPE_PX).toBe(SHEET_SWIPE_PX);
    expect(closesCaption(80, 0)).toBe(closesSheet(80, 0));
    expect(closesCaption(79, 0)).toBe(false);
  });
});
