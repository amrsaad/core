/**
 * Runde 50c: Rückfall für das zu kurze Layout-Fenster der installierten iPhone-App (WebKit-Fehler 301108).
 * Befund vom Gerät (393x852, Sicherheitsrand oben 59): innerHeight ist 793, also screen.height minus die obere Sicherheitsrand-Höhe, solange die Seite kürzer als der Bildschirm ist.
 * Die Hauptabhilfe steht in phone.css (html min-height). Greift sie nicht, erkennt die Funktion unten genau diesen Fall, damit die untere Leiste nicht angeschnitten wird.
 * Rein, ohne Browser, damit sie in Node getestet wird.
 */
export interface PhoneViewportInput {
  /** installierte Web-App (navigator.standalone oder display-mode standalone) */
  standalone: boolean;
  /** Hochformat */
  portrait: boolean;
  screenH: number;
  innerH: number;
  /** obere Sicherheitsrand-Höhe in px */
  safeT: number;
}

/** Fenster kürzer als der Bildschirm um genau die Statusleiste? Bedingungen: Standalone, Hochformat, Differenz 20 bis 80 px, Differenz höchstens 4 px von der oberen Sicherheitsrand-Höhe entfernt. */
export function phoneShortWindow(i: PhoneViewportInput): boolean {
  if (!i.standalone || !i.portrait) return false;
  if (![i.screenH, i.innerH, i.safeT].every((n) => Number.isFinite(n) && n >= 0)) return false;
  const diff = i.screenH - i.innerH;
  if (diff < 20 || diff > 80) return false;
  return Math.abs(diff - i.safeT) <= 4;
}

const r = (n: number | undefined): string => (n === undefined || !Number.isFinite(n) ? '?' : String(Math.round(n * 10) / 10));
const pair = (t?: number, b?: number): string => (t === undefined ? 'none' : `${r(t)},${r(b)}`);

export interface PhoneViewportReading {
  iw: number; ih: number; vvh?: number; ch: number; sw: number; sh: number; st: number; sb: number;
  standalone: boolean; ios: string;
  head?: [number, number]; bar?: [number, number]; feed?: [number, number];
  /** Wert von document.documentElement.scrollHeight */
  dh: number;
  /** window.scrollY */
  sy: number;
  /** Element an (Breite/2, 2): tagName.ersteKlasse oder none */
  top: string;
  /** Höhe des festen Bandes #ios-edge-band in px oder none (nicht angezeigt) */
  band?: number;
  /** Erstes Element mit position fixed in der Kette des Elements am Punkt (Breite/2, 4): tagName.id oder tagName.ersteKlasse oder none */
  pt?: string;
  /** Rückfall aktiv (data-ph-short) */
  short: boolean;
}

/** Diag-Zeile "vp: ..." (keine personenbezogenen Daten, vom User-Agent nur die Hauptversion) */
export function phoneViewportLine(v: PhoneViewportReading): string {
  return `vp: iw=${r(v.iw)} ih=${r(v.ih)} vvh=${r(v.vvh)} ch=${r(v.ch)} sw=${r(v.sw)} sh=${r(v.sh)} st=${r(v.st)} sb=${r(v.sb)} standalone=${v.standalone ? 'yes' : 'no'} ios=${v.ios} head=${pair(v.head?.[0], v.head?.[1])} bar=${pair(v.bar?.[0], v.bar?.[1])} feed=${pair(v.feed?.[0], v.feed?.[1])} dh=${r(v.dh)} sy=${r(v.sy)} top=${v.top} band=${v.band === undefined ? 'none' : r(v.band)} pt=${v.pt ?? 'none'} short=${v.short ? 'yes' : 'no'}`;
}

/** Hauptversion von iOS aus dem User-Agent oder "?" */
export function iosMajor(ua: string): string {
  const m = /OS (\d+)[_.]/.exec(ua) ?? /Version\/(\d+)\./.exec(ua);
  return m ? m[1] : '?';
}

/** Höchstens eine Zeile je 2 s (gap überschreibt den Abstand, z. B. für die Wiederholung nach 1,5 s) und fünf je Sitzung */
export function makeVpLimiter(minGapMs = 2000, max = 5) {
  let n = 0;
  let last = -Infinity;
  return (now: number, gap = minGapMs): boolean => {
    if (n >= max || now - last < gap) return false;
    n++;
    last = now;
    return true;
  };
}
