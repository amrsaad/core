// Runde 40: Geräteprotokoll 25.11. 07:37, grauer Schleier über dem ganzen Video-Reiter nach Abrufkarte und Reiterwechsel, lokal nicht nachstellbar.
// Diese Prüfung protokolliert beim Reiterwechsel und beim Schließen der Abrufkarte jede sichtbare Vollbild-Ebene mit Klassenname und Deckkraft,
// damit der nächste Gerätefall die Ursache zeigt. Sie ändert nichts am Bildschirm.
import { diagLog } from './diag';

/** Messwerte einer Ebene, getrennt vom DOM, damit die Regel ohne Browser prüfbar ist */
export interface LayerInfo {
  cls: string;
  /** Anteil der Fläche des Fensters, den die Ebene deckt (0 bis 1, Breite und Höhe je gedeckelt) */
  w: number;
  h: number;
  /** Eigene Deckkraft mal die aller Vorfahren */
  opacity: number;
  /** Alpha des eigenen Hintergrunds (0 bis 1) */
  bgAlpha: number;
  /** backdrop-filter oder filter gesetzt */
  filtered: boolean;
  visible: boolean;
  /** Nur bei Leinwand (Ambient): mittlere Farbe des Bildes als #rrggbb mit Alpha-Anteil, sonst leer. Ein heller Wert bei opacity=0.32 ergibt auf dem dunklen Hintergrund genau einen grauen Schleier. */
  px?: string;
}

/** Eine Ebene zählt, wenn sie fast das ganze Fenster deckt, sichtbar ist und etwas darunter verändert (Hintergrund, Deckkraft unter 1 oder Filter) */
export const isCover = (l: LayerInfo): boolean => l.visible && l.w >= 0.85 && l.h >= 0.85 && (l.bgAlpha > 0 || l.opacity < 0.995 || l.filtered);

/** Protokollzeile je Ebene: "ui: overlay <klasse> opacity=<x> after tab <reiter>" (plus Hintergrund-Alpha, damit ein Schleier ohne Deckkraft auffällt) */
export const overlayLine = (l: LayerInfo, tab: string): string => `ui: overlay ${l.cls || '(no class)'} opacity=${l.opacity.toFixed(2)} bg=${l.bgAlpha.toFixed(2)} after tab ${tab}${l.px ? ` px=${l.px}` : ''}`;

const alphaOf = (c: string): number => {
  if (c === 'transparent') return 0;
  const m = /^rgba?\(([^)]*)\)$/.exec(c.trim());
  if (!m) return 1;
  const p = m[1].split(/[ ,/]+/).filter(Boolean);
  return p.length >= 4 ? Number(p[3]) : 1;
};

/** Mittlere Farbe einer Leinwand (24 mal 42 Pixel bei Ambient), alpha-gewichtet, plus Anteil gezeichneter Pixel. Leer, wenn nicht lesbar. */
function canvasAvg(el: HTMLElement): string | undefined {
  if (!(el instanceof HTMLCanvasElement) || !el.width || !el.height || el.width * el.height > 4096) return undefined;
  try {
    const d = el.getContext('2d')?.getImageData(0, 0, el.width, el.height).data;
    if (!d) return undefined;
    let r = 0, g = 0, b = 0, a = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i] * d[i + 3]; g += d[i + 1] * d[i + 3]; b += d[i + 2] * d[i + 3]; a += d[i + 3]; }
    const n = d.length / 4;
    const hex = (v: number) => Math.round(a ? v / a : 0).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}/${(a / (255 * n)).toFixed(2)}`;
  } catch {
    return undefined;
  }
}

/** Alle Ebenen im Dokument messen, die fast das ganze Fenster füllen (position absolute oder fixed) */
export function measureLayers(doc: Document = document): LayerInfo[] {
  const win = doc.defaultView;
  if (!win) return [];
  const vw = win.innerWidth || 1;
  const vh = win.innerHeight || 1;
  const out: LayerInfo[] = [];
  for (const el of Array.from(doc.body.querySelectorAll<HTMLElement>('*'))) {
    const cs = win.getComputedStyle(el);
    if (cs.position !== 'absolute' && cs.position !== 'fixed' && cs.position !== 'relative') continue;
    if (cs.display === 'none') continue;
    const r = el.getBoundingClientRect();
    const w = Math.min(r.right, vw) - Math.max(r.left, 0);
    const h = Math.min(r.bottom, vh) - Math.max(r.top, 0);
    if (w < vw * 0.85 || h < vh * 0.85) continue;
    let op = 1;
    for (let p: HTMLElement | null = el; p; p = p.parentElement) op *= Number(win.getComputedStyle(p).opacity);
    out.push({
      cls: typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3).join('.') : '',
      w: w / vw,
      h: h / vh,
      opacity: op,
      bgAlpha: alphaOf(cs.backgroundColor),
      filtered: (cs.backdropFilter && cs.backdropFilter !== 'none') || (cs.filter && cs.filter !== 'none') ? true : false,
      visible: cs.visibility !== 'hidden',
      px: canvasAvg(el),
    });
  }
  return out;
}

/** Zentraler Prüfpunkt: Reiterwechsel (Form oder Bereich) und Schließen der Abrufkarte. Gibt die Zeilen zurück und schreibt sie ins Protokoll. */
export function auditCovers(tab: string, doc: Document = document): string[] {
  const lines = measureLayers(doc).filter(isCover).map((l) => overlayLine(l, tab));
  for (const l of lines) diagLog.push(l);
  return lines;
}
