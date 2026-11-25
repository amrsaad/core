// Runde 40: Regel der Vollbild-Prüfung und Format der Protokollzeile (Gerätefall 25.11. 07:37, grauer Schleier im Video-Reiter)
import { describe, expect, it } from 'vitest';
import { isCover, overlayLine, type LayerInfo } from '../src/lib/overlayAudit';

const base: LayerInfo = { cls: 'vfeed', w: 1, h: 1, opacity: 1, bgAlpha: 0, filtered: false, visible: true };

describe('overlayAudit', () => {
  it('eine durchsichtige Ebene ohne Filter ist keine Abdeckung', () => {
    expect(isCover(base)).toBe(false);
  });
  it('Hintergrund, Deckkraft unter 1 oder Filter machen eine Vollbild-Ebene zur Abdeckung', () => {
    expect(isCover({ ...base, bgAlpha: 0.35 })).toBe(true);
    expect(isCover({ ...base, bgAlpha: 1 })).toBe(true);
    expect(isCover({ ...base, opacity: 0.6 })).toBe(true);
    expect(isCover({ ...base, filtered: true })).toBe(true);
  });
  it('kleine oder verborgene Ebenen zählen nicht', () => {
    expect(isCover({ ...base, bgAlpha: 1, w: 0.5 })).toBe(false);
    expect(isCover({ ...base, bgAlpha: 1, h: 0.8 })).toBe(false);
    expect(isCover({ ...base, bgAlpha: 1, visible: false })).toBe(false);
  });
  it('Protokollzeile im festen Format', () => {
    expect(overlayLine({ ...base, bgAlpha: 0.55, opacity: 0.5, cls: 'sheet-backdrop' }, 'feed/video')).toBe('ui: overlay sheet-backdrop opacity=0.50 bg=0.55 after tab feed/video');
    expect(overlayLine({ ...base, cls: '' }, 'saved/audio')).toBe('ui: overlay (no class) opacity=1.00 bg=0.00 after tab saved/audio');
  });
});
