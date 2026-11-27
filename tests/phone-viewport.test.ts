import { describe, expect, it } from 'vitest';
import { iosMajor, makeVpLimiter, phoneTargetHeight, phoneViewportLine } from '../src/moments/phone/viewport';
import { PHONE_TOP_CLEAR_PX, phoneTopClear } from '../src/moments/phone/flags';

// Runde 50: Zielhöhe des Feeds in der installierten App (Befund vom Gerät: 393x852, innerHeight 793, Sicherheitsrand oben 59)
const dev = { standalone: true, portrait: true, screenH: 852, innerH: 793, safeT: 59 };

describe('phoneTargetHeight', () => {
  it('Gerätefehler: Differenz gleich Sicherheitsrand oben, dann ganze Bildschirmhöhe', () => {
    expect(phoneTargetHeight(dev)).toBe(852);
  });
  it('Toleranz von 4 px zur oberen Sicherheitsrand-Höhe', () => {
    expect(phoneTargetHeight({ ...dev, safeT: 55 })).toBe(852);
    expect(phoneTargetHeight({ ...dev, safeT: 63 })).toBe(852);
    expect(phoneTargetHeight({ ...dev, safeT: 54 })).toBeNull();
    expect(phoneTargetHeight({ ...dev, safeT: 64 })).toBeNull();
  });
  it('keine Korrektur ohne Standalone, im Querformat oder bei gleicher Höhe', () => {
    expect(phoneTargetHeight({ ...dev, standalone: false })).toBeNull();
    expect(phoneTargetHeight({ ...dev, portrait: false })).toBeNull();
    expect(phoneTargetHeight({ ...dev, innerH: 852 })).toBeNull();
  });
  it('Differenz nur zwischen 20 und 80 px', () => {
    expect(phoneTargetHeight({ ...dev, innerH: 832, safeT: 20 })).toBe(852);
    expect(phoneTargetHeight({ ...dev, innerH: 833, safeT: 19 })).toBeNull();
    expect(phoneTargetHeight({ ...dev, innerH: 772, safeT: 80 })).toBe(852);
    expect(phoneTargetHeight({ ...dev, innerH: 771, safeT: 81 })).toBeNull();
  });
  it('Differenz weicht vom Sicherheitsrand ab (Adressleiste, Tastatur): keine Korrektur', () => {
    expect(phoneTargetHeight({ ...dev, innerH: 700 })).toBeNull();
    expect(phoneTargetHeight({ ...dev, safeT: 0 })).toBeNull();
  });
  it('ungültige Zahlen: keine Korrektur', () => {
    expect(phoneTargetHeight({ ...dev, screenH: NaN })).toBeNull();
    expect(phoneTargetHeight({ ...dev, innerH: -1 })).toBeNull();
  });
});

describe('Diag-Zeile vp', () => {
  it('Format mit allen Feldern', () => {
    const l = phoneViewportLine({ iw: 393, ih: 793, vvh: 793, ch: 793, sw: 393, sh: 852, st: 59, sb: 34, standalone: true, ios: '18', head: [0, 103], bar: [657, 793], feed: [0, 793], fix: 852 });
    expect(l).toBe('vp: iw=393 ih=793 vvh=793 ch=793 sw=393 sh=852 st=59 sb=34 standalone=yes ios=18 head=0,103 bar=657,793 feed=0,793 fix=852');
  });
  it('fehlende Teile: none und ?', () => {
    const l = phoneViewportLine({ iw: 390, ih: 844, ch: 844, sw: 390, sh: 844, st: 0, sb: 0, standalone: false, ios: '?', fix: null });
    expect(l).toBe('vp: iw=390 ih=844 vvh=? ch=844 sw=390 sh=844 st=0 sb=0 standalone=no ios=? head=none bar=none feed=none fix=none');
  });
  it('nur die Hauptversion aus dem User-Agent', () => {
    expect(iosMajor('Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1')).toBe('18');
    expect(iosMajor('Mozilla/5.0 (X11; Linux x86_64) Chrome/120')).toBe('?');
  });
});

describe('Begrenzung der Diag-Zeilen', () => {
  it('höchstens eine Zeile je 2 s und fünf je Sitzung', () => {
    const ok = makeVpLimiter();
    expect(ok(0)).toBe(true);
    expect(ok(1999)).toBe(false);
    expect(ok(2000)).toBe(true);
    expect(ok(4000)).toBe(true);
    expect(ok(6000)).toBe(true);
    expect(ok(8000)).toBe(true);
    expect(ok(10000)).toBe(false);
  });
});

describe('Abstand oben', () => {
  it('ausgeliefert aus (0), ohne Browser kein Fehler', () => {
    expect(PHONE_TOP_CLEAR_PX).toBe(0);
    expect(phoneTopClear()).toBe(0);
  });
});
