import { describe, expect, it } from 'vitest';
import { iosMajor, makeVpLimiter, phoneShortWindow, phoneViewportLine } from '../src/moments/phone/viewport';
import { PHONE_TOP_CLEAR_PX, phoneTopClear } from '../src/moments/phone/flags';

// Runde 50c: zu kurzes Fenster in der installierten App (Befund vom Gerät: 393x852, innerHeight 793, Sicherheitsrand oben 59)
const dev = { standalone: true, portrait: true, screenH: 852, innerH: 793, safeT: 59 };

describe('phoneShortWindow', () => {
  it('Gerätefehler: Differenz gleich Sicherheitsrand oben, dann kurzes Fenster', () => {
    expect(phoneShortWindow(dev)).toBe(true);
  });
  it('Toleranz von 4 px zur oberen Sicherheitsrand-Höhe', () => {
    expect(phoneShortWindow({ ...dev, safeT: 55 })).toBe(true);
    expect(phoneShortWindow({ ...dev, safeT: 63 })).toBe(true);
    expect(phoneShortWindow({ ...dev, safeT: 54 })).toBe(false);
    expect(phoneShortWindow({ ...dev, safeT: 64 })).toBe(false);
  });
  it('keine Korrektur ohne Standalone, im Querformat oder bei gleicher Höhe', () => {
    expect(phoneShortWindow({ ...dev, standalone: false })).toBe(false);
    expect(phoneShortWindow({ ...dev, portrait: false })).toBe(false);
    expect(phoneShortWindow({ ...dev, innerH: 852 })).toBe(false);
  });
  it('Differenz nur zwischen 20 und 80 px', () => {
    expect(phoneShortWindow({ ...dev, innerH: 832, safeT: 20 })).toBe(true);
    expect(phoneShortWindow({ ...dev, innerH: 833, safeT: 19 })).toBe(false);
    expect(phoneShortWindow({ ...dev, innerH: 772, safeT: 80 })).toBe(true);
    expect(phoneShortWindow({ ...dev, innerH: 771, safeT: 81 })).toBe(false);
  });
  it('Differenz weicht vom Sicherheitsrand ab (Adressleiste, Tastatur): keine Korrektur', () => {
    expect(phoneShortWindow({ ...dev, innerH: 700 })).toBe(false);
    expect(phoneShortWindow({ ...dev, safeT: 0 })).toBe(false);
  });
  it('ungültige Zahlen: keine Korrektur', () => {
    expect(phoneShortWindow({ ...dev, screenH: NaN })).toBe(false);
    expect(phoneShortWindow({ ...dev, innerH: -1 })).toBe(false);
  });
});

describe('Diag-Zeile vp', () => {
  it('Format mit allen Feldern', () => {
    const l = phoneViewportLine({ iw: 393, ih: 793, vvh: 793, ch: 793, sw: 393, sh: 852, st: 59, sb: 34, standalone: true, ios: '18', head: [0, 103], bar: [657, 793], feed: [0, 793], dh: 852, sy: 0, top: 'DIV.head', short: true });
    expect(l).toBe('vp: iw=393 ih=793 vvh=793 ch=793 sw=393 sh=852 st=59 sb=34 standalone=yes ios=18 head=0,103 bar=657,793 feed=0,793 dh=852 sy=0 top=DIV.head short=yes');
  });
  it('fehlende Teile: none und ?', () => {
    const l = phoneViewportLine({ iw: 390, ih: 844, ch: 844, sw: 390, sh: 844, st: 0, sb: 0, standalone: false, ios: '?', dh: 844, sy: 0, top: 'none', short: false });
    expect(l).toBe('vp: iw=390 ih=844 vvh=? ch=844 sw=390 sh=844 st=0 sb=0 standalone=no ios=? head=none bar=none feed=none dh=844 sy=0 top=none short=no');
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
  it('Wiederholung nach 1,5 s mit eigenem Abstand zählt zu den fünf', () => {
    const ok = makeVpLimiter();
    expect(ok(0)).toBe(true);
    expect(ok(1500)).toBe(false);
    expect(ok(1500, 0)).toBe(true);
    expect(ok(2000, 0)).toBe(true);
    expect(ok(2001, 0)).toBe(true);
    expect(ok(2002, 0)).toBe(true);
    expect(ok(2003, 0)).toBe(false);
  });
});

describe('Abstand oben', () => {
  it('ausgeliefert aus (0), ohne Browser kein Fehler', () => {
    expect(PHONE_TOP_CLEAR_PX).toBe(0);
    expect(phoneTopClear()).toBe(0);
  });
});
