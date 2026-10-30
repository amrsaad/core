import type { AppState } from '../lib/state';
import { atTime } from './hook';
import { momentText } from './form';
import { signal } from './learn';
import { SIGNAL } from './mix';
import { fullVideoUrl, type Moment } from './types';

/**
 * Ask (Entscheidung 18 in core-content): Der Knopf im "..."-Blatt öffnet claude.ai mit einem vorausgefüllten Prompt.
 * Kein Chatbot in der App, keine API-Kosten. Reines Modul ohne Browserzugriff.
 *
 * Prompt (US English), eine Angabe pro Zeile, fehlende Angaben entfallen:
 *   Core moment from <channel>, <episode title>, at <time>.
 *   Hook: <hook>
 *   Excerpt: <excerpt, höchstens 600 Zeichen>
 *   Context: <context>
 *   Source: <full video url>
 *   (Leerzeile)
 *   My question:
 * Der Prompt hat weniger als 1500 Zeichen. Normale Moment-Felder passen ohne Kürzung. Wird es zu lang, schrumpft zuerst der Kontext,
 * dann der Ausschnitt (der Ausschnitt ist der Kern), Hook, Folge und Quelle bleiben.
 */

export const ASK_BASE = 'https://claude.ai/new?q=';
/** Der Prompt hat weniger Zeichen als dieser Wert */
export const ASK_MAX = 1500;
export const EXCERPT_MAX = 600;
/** Obergrenze für den codierten Prompt. Arabisch wird dreimal so lang (sechs Zeichen je Buchstabe), die Adresse soll trotzdem überall durchgehen. */
export const ASK_ENCODED_MAX = 8000;

const ASK_ENDING = 'My question: ';

/** Zeilenumbrüche und Mehrfach-Leerzeichen werden zu einem Leerzeichen, damit jede Angabe genau eine Zeile bleibt */
const oneLine = (s: string | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

/** Auf höchstens max Zeichen kürzen (Auslassungspunkt eingerechnet), nie mitten in einem Zeichenpaar, wenn möglich am Wortende */
export function clip(s: string, max: number): string {
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  if (max <= 0) return '';
  let cut = chars.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  if (space > cut.length * 0.7) cut = cut.slice(0, space);
  return `${cut.join('').trimEnd()}…`;
}

interface Budget {
  excerpt: number;
  context: number;
}

function build(m: Moment, b: Budget): string {
  const channel = oneLine(m.channel);
  const title = oneLine(m.videoTitle);
  const head = [`Core moment from ${channel}`];
  if (title) head.push(title);
  // Textquellen haben keine Stelle in einer Folge
  if (m.form !== 'text' && Number.isFinite(m.start) && m.start >= 0) head.push(`at ${atTime(m.start)}`);
  const lines = [`${head.join(', ')}.`, `Hook: ${oneLine(m.hook)}`];
  const excerpt = clip(oneLine(momentText(m)), b.excerpt);
  if (excerpt) lines.push(`Excerpt: ${excerpt}`);
  const context = clip(oneLine(m.context), b.context);
  if (context) lines.push(`Context: ${context}`);
  const source = fullVideoUrl(m);
  if (source) lines.push(`Source: ${source}`);
  return `${lines.join('\n')}\n\n${ASK_ENDING}`;
}

const fits = (p: string) => p.length < ASK_MAX && encodeURIComponent(p).length <= ASK_ENCODED_MAX;

/** Der Prompt für Claude. Passt er nicht, schrumpft zuerst der Kontext, dann der Ausschnitt (der ohnehin bei 600 Zeichen endet). */
export function askPrompt(m: Moment): string {
  const b: Budget = { excerpt: EXCERPT_MAX, context: Array.from(oneLine(m.context)).length };
  let p = build(m, b);
  while (!fits(p) && b.context > 0) {
    b.context = b.context > 40 ? Math.floor(b.context * 0.85) : 0;
    p = build(m, b);
  }
  while (!fits(p) && b.excerpt > 0) {
    b.excerpt = b.excerpt > 40 ? Math.floor(b.excerpt * 0.85) : 0;
    p = build(m, b);
  }
  // Letzte Absicherung (Hook oder Titel unüblich lang): vorn kürzen, das Ende "My question: " bleibt
  if (!fits(p)) {
    const room = Math.min(ASK_MAX - 1, Math.floor(ASK_ENCODED_MAX / 6)) - ASK_ENDING.length - 2;
    p = `${clip(p.slice(0, p.length - ASK_ENDING.length).trimEnd(), room)}\n\n${ASK_ENDING}`;
  }
  return p;
}

/** Adresse für window.open, der Prompt vollständig codiert (Zeilenumbruch, Leerzeichen, &, #, Arabisch) */
export const askUrl = (m: Moment): string => `${ASK_BASE}${encodeURIComponent(askPrompt(m))}`;

/**
 * Lernsignal: Ask zählt wie More (Faktor 1,3). Beim ersten Ask eines Moments wirkt das Signal, jeder weitere Ask setzt nur die Zeit neu,
 * damit dasselbe Nachfragen den Feed nicht immer weiter in eine Richtung zieht. Das Herz (momentLiked) bleibt unberührt.
 * Die Zeit (askedAt, ms, Feld momentAsked je Moment-ID) wandert per Sync auf alle Geräte und steht im Zustand, den der Digest liest.
 * at ist die Uhrzeit des Ask (Date.now), now die Uhr der App für das Lernen (clockNow).
 */
export function markAsked(s: AppState, m: Moment, at: number, now: number): AppState {
  const first = !s.momentAsked?.[m.id];
  return {
    ...s,
    momentAsked: { ...(s.momentAsked ?? {}), [m.id]: at },
    momentWeights: first ? signal(s.momentWeights, m, SIGNAL.more, now) : s.momentWeights,
  };
}
