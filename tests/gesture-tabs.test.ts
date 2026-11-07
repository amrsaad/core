import { describe, expect, it } from 'vitest';
import { isFlat, TAB_SWIPE_DEG, TAB_SWIPE_PX, tabAfterSwipe, tabSwipe } from '../src/moments/gesture';
import { FORMS } from '../src/moments/form';

// Entscheidung 54, Brief 16: waagerechter Wisch auf dem Moment wechselt den Reiter, links nächster, rechts voriger.
describe('Reiterwechsel per Wisch (Entscheidung 54)', () => {
  it('Schwelle 60 px, Winkel 30 Grad', () => {
    expect(TAB_SWIPE_PX).toBe(60);
    expect(TAB_SWIPE_DEG).toBe(30);
  });
  it('links ab 60 px ist der nächste Reiter, rechts der vorige', () => {
    expect(tabSwipe(-60, 0)).toBe('tabNext');
    expect(tabSwipe(60, 0)).toBe('tabPrev');
    expect(tabSwipe(-59, 0)).toBeNull();
    expect(tabSwipe(59, 0)).toBeNull();
  });
  it('flacher als 30 Grad zählt, steiler ist senkrecht', () => {
    // tan(30 Grad) = 0,577: bei 100 px Weg sind bis 57 px Höhe erlaubt
    expect(tabSwipe(-100, 57)).toBe('tabNext');
    expect(tabSwipe(-100, -57)).toBe('tabNext');
    expect(tabSwipe(-100, 58)).toBeNull();
    expect(tabSwipe(-100, 120)).toBeNull();
    expect(isFlat(10, 5)).toBe(true);
    expect(isFlat(10, 6)).toBe(false);
    expect(isFlat(0, 0)).toBe(false);
  });
  it('Reihenfolge wie die Kopfzeile, am Rand passiert nichts', () => {
    expect(FORMS).toEqual(['video', 'audio', 'text']);
    expect(tabAfterSwipe(FORMS, 'video', 'tabNext')).toBe('audio');
    expect(tabAfterSwipe(FORMS, 'audio', 'tabNext')).toBe('text');
    expect(tabAfterSwipe(FORMS, 'text', 'tabNext')).toBeNull();
    expect(tabAfterSwipe(FORMS, 'text', 'tabPrev')).toBe('audio');
    expect(tabAfterSwipe(FORMS, 'video', 'tabPrev')).toBeNull();
    expect(tabAfterSwipe(FORMS, 'video', null)).toBeNull();
  });
});
