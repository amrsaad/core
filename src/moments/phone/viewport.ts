/**
 * Runde 50: Höhe des Feeds in der installierten iPhone-App.
 * Befund vom Gerät (393x852, Sicherheitsrand oben 59): innerHeight ist 793, also screen.height minus die obere Sicherheitsrand-Höhe. Das Layout-Fenster endet 59 pt über dem unteren Rand,
 * die Fläche darunter blieb leer. Die Funktion unten erkennt genau diesen Fall und gibt die Höhe zurück, die der Feed haben soll (der ganze Bildschirm). In jedem anderen Fall null, dann bleibt es bei inset 0.
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

/** Zielhöhe in px oder null (keine Korrektur). Bedingungen: Standalone, Hochformat, Differenz 20 bis 80 px, Differenz höchstens 4 px von der oberen Sicherheitsrand-Höhe entfernt. */
export function phoneTargetHeight(i: PhoneViewportInput): number | null {
  if (!i.standalone || !i.portrait) return null;
  if (![i.screenH, i.innerH, i.safeT].every((n) => Number.isFinite(n) && n >= 0)) return null;
  const diff = i.screenH - i.innerH;
  if (diff < 20 || diff > 80) return null;
  if (Math.abs(diff - i.safeT) > 4) return null;
  return Math.round(i.screenH);
}

const r = (n: number | undefined): string => (n === undefined || !Number.isFinite(n) ? '?' : String(Math.round(n * 10) / 10));
const pair = (t?: number, b?: number): string => (t === undefined ? 'none' : `${r(t)},${r(b)}`);

export interface PhoneViewportReading {
  iw: number; ih: number; vvh?: number; ch: number; sw: number; sh: number; st: number; sb: number;
  standalone: boolean; ios: string;
  head?: [number, number]; bar?: [number, number]; feed?: [number, number];
  fix: number | null;
}

/** Diag-Zeile "vp: ..." (keine personenbezogenen Daten, vom User-Agent nur die Hauptversion) */
export function phoneViewportLine(v: PhoneViewportReading): string {
  return `vp: iw=${r(v.iw)} ih=${r(v.ih)} vvh=${r(v.vvh)} ch=${r(v.ch)} sw=${r(v.sw)} sh=${r(v.sh)} st=${r(v.st)} sb=${r(v.sb)} standalone=${v.standalone ? 'yes' : 'no'} ios=${v.ios} head=${pair(v.head?.[0], v.head?.[1])} bar=${pair(v.bar?.[0], v.bar?.[1])} feed=${pair(v.feed?.[0], v.feed?.[1])} fix=${v.fix === null ? 'none' : v.fix}`;
}

/** Hauptversion von iOS aus dem User-Agent oder "?" */
export function iosMajor(ua: string): string {
  const m = /OS (\d+)[_.]/.exec(ua) ?? /Version\/(\d+)\./.exec(ua);
  return m ? m[1] : '?';
}

/** Höchstens eine Zeile je 2 s und fünf je Sitzung */
export function makeVpLimiter(minGapMs = 2000, max = 5) {
  let n = 0;
  let last = -Infinity;
  return (now: number): boolean => {
    if (n >= max || now - last < minGapMs) return false;
    n++;
    last = now;
    return true;
  };
}
