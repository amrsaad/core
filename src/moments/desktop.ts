/**
 * Desktop-Modus ab 900 px Breite (Auftrag Max 28.10.2026). Reine Regeln, ohne React und ohne DOM, damit sie sich ohne Browser prüfen lassen.
 * Mobil bleibt unverändert. Was hier steht, gilt nur, wenn die Breite mindestens DESKTOP_MIN beträgt.
 *
 * Tasten: Pfeile oder J und K blättern, Leertaste Pause, M stumm, Shift+. schaltet das Tempo, L Herz, S Save, O Source,
 * F Rückmeldung (1 bis 6 Chips, Enter Text), A Ask (auch bei offenem Blatt), 1 2 3 Reiter, C Caption, Esc schließt, bei der Abrufkarte 1 2 3 Antwort und
 * Enter Next, ? zeigt die Übersicht.
 * Trackpad: zwei Finger senkrecht blättert (ein Wisch ist ein Schritt, der Nachlauf zählt nicht), zwei Finger nach links öffnet die Rückmeldung.
 */
import { SWIPE_PX } from './actions';
import type { Form } from './form';

export const DESKTOP_MIN = 900;
export const DESKTOP_QUERY = `(min-width: ${DESKTOP_MIN}px)`;
/** Spalte mit Video, Audio und Abruf, Bild immer 16:9 */
export const COLUMN_PX = 480;
/** Lesebreite im Textreiter in Zeichen */
export const READ_CH = 65;
export const PANEL_MAX_PX = 400;
export const BAR_PX = 56;
/** Zielgröße der kompakten Spalte in Pixel (mobil 48 pt) */
export const DESK_TARGET_PX = 36;

export interface KeyIn {
  key: string;
  code: string;
  shift: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
}

export interface DeskCtx {
  /** Fokus in einem Eingabefeld */
  typing: boolean;
  /** Übersicht offen */
  help: boolean;
  /** Seitenblatt (Settings oder Saved) offen */
  sheet: boolean;
  /** Rückmeldung offen */
  note: boolean;
  /** Abrufkarte: offen (noch keine Antwort) oder beantwortet */
  recall: 'open' | 'answered' | null;
}

export type DeskAction =
  | 'next'
  | 'prev'
  | 'pause'
  | 'mute'
  | 'like'
  | 'save'
  | 'source'
  | 'note'
  | 'ask'
  | 'caption'
  | 'close'
  | 'help'
  | 'tempo'
  | 'noteText'
  | 'recallNext'
  | 'tab1'
  | 'tab2'
  | 'tab3'
  | 'chip1'
  | 'chip2'
  | 'chip3'
  | 'chip4'
  | 'chip5'
  | 'chip6'
  | 'pick1'
  | 'pick2'
  | 'pick3';

/** Reiter in der Reihenfolge der Tasten 1 2 3 */
export const TAB_KEYS: Form[] = ['video', 'audio', 'text'];

/**
 * Welche Aktion löst diese Taste im gegebenen Zustand aus? null heißt: nichts tun, die Taste bleibt dem Browser.
 * Strg, Cmd und Alt gehören dem Browser (Neu laden, Reiter wechseln). Esc geht immer durch, im Eingabefeld sonst nichts.
 */
export function deskKey(ctx: DeskCtx, k: KeyIn): DeskAction | null {
  if (k.ctrl || k.meta || k.alt) return null;
  const key = k.key.length === 1 ? k.key.toLowerCase() : k.key;
  if (key === 'Escape') return 'close';
  if (ctx.typing) return null;
  if (key === '?') return 'help';
  if (ctx.help || ctx.sheet) return null;
  if (ctx.note) {
    if (/^[1-6]$/.test(key)) return `chip${key}` as DeskAction;
    if (key === 'a') return 'ask';
    return key === 'Enter' ? 'noteText' : null;
  }
  if (ctx.recall) {
    if (ctx.recall === 'open' && /^[1-3]$/.test(key)) return `pick${key}` as DeskAction;
    return ctx.recall === 'answered' && key === 'Enter' ? 'recallNext' : null;
  }
  // Shift+. hängt an der Taste, nicht am Zeichen (auf der Schweizer Tastatur ist Shift+. ein Doppelpunkt)
  if (k.shift && k.code === 'Period') return 'tempo';
  if (k.code === 'Space' || key === ' ') return 'pause';
  switch (key) {
    case 'ArrowDown':
    case 'j':
    case 'MediaTrackNext':
      return 'next';
    case 'ArrowUp':
    case 'k':
    case 'MediaTrackPrevious':
      return 'prev';
    case 'MediaPlayPause':
      return 'pause';
    case 'm':
      return 'mute';
    case 'l':
      return 'like';
    case 's':
      return 'save';
    case 'o':
      return 'source';
    case 'f':
      return 'note';
    case 'a':
      return 'ask';
    case 'c':
      return 'caption';
    case '1':
    case '2':
    case '3':
      return `tab${key}` as DeskAction;
    default:
      return null;
  }
}

/** Die Übersicht erscheint genau einmal, beim ersten Start im Desktop-Modus */
export const deskHelpDue = (seen: boolean | undefined): boolean => !seen;

/** Zeilen der Übersicht, links Tasten, rechts Wirkung. E2E prüft, dass jede Taste hier steht. */
export const HELP_ROWS: { keys: string; text: string }[] = [
  { keys: 'Down or J', text: 'Next moment' },
  { keys: 'Up or K', text: 'Previous moment' },
  { keys: 'Space', text: 'Pause or play' },
  { keys: 'M', text: 'Mute or unmute' },
  { keys: 'Shift + .', text: 'Speed: 1x, 1.5x, 2x' },
  { keys: 'L', text: 'More like this' },
  { keys: 'S', text: 'Save' },
  { keys: 'O', text: 'Open the source' },
  { keys: 'F', text: 'Feedback, then 1 to 6 for a chip or Enter for text' },
  { keys: 'A', text: 'Ask Claude about this moment' },
  { keys: '1 2 3', text: 'Video, Audio, Text' },
  { keys: 'C', text: 'Caption' },
  { keys: 'Esc', text: 'Close' },
  { keys: '1 2 3', text: 'On a recall card: answer. Enter: Next' },
  { keys: '?', text: 'This list' },
  { keys: 'Two fingers up or down', text: 'Next or previous moment' },
  { keys: 'Two fingers left', text: 'Feedback' },
];

// ---------- Trackpad ----------

/** Pause ohne Ereignis, ab der ein neuer Wisch beginnt (der Nachlauf der Finger endet davor) */
export const WHEEL_QUIET_MS = 160;
/** Weg, ab dem ein Wisch zählt, gleich wie mobil */
export const WHEEL_PX = SWIPE_PX;

export interface WheelIn {
  dx: number;
  dy: number;
  /** Zeitstempel in ms */
  t: number;
}
/** Nur im Textreiter: steht der Text oben, steht er unten */
export interface WheelEdge {
  top: boolean;
  end: boolean;
}
export interface WheelOut {
  act: 'next' | 'prev' | 'note' | null;
  /** true: preventDefault, die Seite scrollt nicht. false: der Text scrollt selbst. */
  consume: boolean;
}

/** Wheel-Ereignis in Pixel (Firefox meldet Zeilen, selten Seiten) */
export function wheelPx(e: { deltaX: number; deltaY: number; deltaMode: number }, pageH = 800): { dx: number; dy: number } {
  const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? pageH : 1;
  return { dx: e.deltaX * k, dy: e.deltaY * k };
}

/**
 * Ein Wisch ist ein Schritt. Nach dem Schritt sperrt die Geste, bis eine Pause kommt oder die Werte wieder deutlich
 * zunehmen (neuer Wisch im Nachlauf). Senkrecht nach unten (Finger nach oben bei natürlichem Scrollen) ist der nächste Moment.
 * Waagerecht: Scrollen nach rechts, also die Finger nach links, öffnet die Rückmeldung. Das Gegenstück macht nichts, wie mobil.
 * Im Text scrollt der Text, bis er am Ende (oder oben) steht. Entscheidend ist der Stand beim Beginn des Wischs, wie mobil.
 */
export function createWheel() {
  let last = -Infinity;
  let ax = 0;
  let ay = 0;
  let minMag = Infinity;
  let mode: 'count' | 'locked' | 'native' = 'count';
  let decided = false;
  const reset = () => {
    ax = 0;
    ay = 0;
    minMag = Infinity;
    mode = 'count';
    decided = false;
  };
  return {
    reset,
    feed(e: WheelIn, edge?: WheelEdge): WheelOut {
      const mag = Math.hypot(e.dx, e.dy);
      const quiet = e.t - last > WHEEL_QUIET_MS;
      last = e.t;
      if (quiet) reset();
      else if (mode !== 'count') {
        minMag = Math.min(minMag, mag);
        // Die Werte steigen wieder: ein neuer Wisch im Nachlauf des alten
        if (mag > minMag * 2 + 8) reset();
      }
      if (mode === 'native') return { act: null, consume: false };
      if (mode === 'locked') return { act: null, consume: true };
      if (edge && !decided && Math.abs(e.dy) >= 1 && Math.abs(e.dy) >= Math.abs(e.dx)) {
        decided = true;
        const blocked = e.dy > 0 ? !edge.end : !edge.top;
        if (blocked) {
          mode = 'native';
          minMag = mag;
          return { act: null, consume: false };
        }
      }
      ax += e.dx;
      ay += e.dy;
      if (Math.abs(ay) >= WHEEL_PX && Math.abs(ay) > Math.abs(ax)) {
        mode = 'locked';
        minMag = mag;
        return { act: ay > 0 ? 'next' : 'prev', consume: true };
      }
      if (Math.abs(ax) >= WHEEL_PX && Math.abs(ax) > Math.abs(ay)) {
        mode = 'locked';
        minMag = mag;
        return { act: ax > 0 ? 'note' : null, consume: true };
      }
      return { act: null, consume: true };
    },
  };
}
