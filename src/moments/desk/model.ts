/**
 * Runde 44: Rechnungen der Mac-Ansicht (Desktop ab 1181 px). Reine Funktionen ohne React und DOM, damit sie sich ohne Browser prüfen lassen.
 * Die Leiste rechnet nur in Sekunden und Anteilen des Ausschnitts [start, end]. Sie ändert nichts an der Wiedergabe.
 */
import type { Area } from '../../types';
import type { Moment } from '../types';

/** Sprung der Pfeiltasten rechts und links, in Sekunden */
export const SEEK_S = 10;
/** Ein Sprung endet mindestens so weit vor dem Ende des Ausschnitts (der Wechsel zum nächsten Moment bleibt Sache des Feeds) */
export const SEEK_END_GUARD_S = 1;
/** So viele Momente zeigt die Warteschlange höchstens (der laufende eingerechnet) */
export const QUEUE_SHOWN = 6;

export const clipLen = (m: Pick<Moment, 'start' | 'end'>): number => Math.max(0, m.end - m.start);

/** Anteil 0 bis 1 einer Position im Ausschnitt. Außerhalb oder bei Länge 0: an die Grenze geklemmt. */
export function fracOf(pos: number, start: number, end: number): number {
  const len = end - start;
  if (!(len > 0) || !Number.isFinite(pos)) return 0;
  return Math.min(1, Math.max(0, (pos - start) / len));
}

/** Quellzeit zu einem Anteil des Ausschnitts, geklemmt auf [start, end - SEEK_END_GUARD_S] (bei sehr kurzen Ausschnitten auf start) */
export function seekPos(f: number, start: number, end: number): number {
  const hi = Math.max(start, end - SEEK_END_GUARD_S);
  const raw = start + (Number.isFinite(f) ? f : 0) * (end - start);
  return Math.min(hi, Math.max(start, raw));
}

/** Neue Quellzeit nach einem Sprung um delta Sekunden, geklemmt wie seekPos */
export function seekBy(pos: number, delta: number, start: number, end: number): number {
  const hi = Math.max(start, end - SEEK_END_GUARD_S);
  const raw = (Number.isFinite(pos) ? pos : start) + delta;
  return Math.min(hi, Math.max(start, raw));
}

/** Position im Ausschnitt in ganzen Sekunden, für die Zeitanzeige (links) */
export const inClip = (frac: number, m: Pick<Moment, 'start' | 'end'>): number => Math.round(Math.min(1, Math.max(0, frac)) * clipLen(m));

/** Zeigerposition auf der Zeitleiste als Anteil: x relativ zur Leiste, Breite der Leiste. Ohne Breite 0. */
export function fracAtPointer(x: number, left: number, width: number): number {
  if (!(width > 0)) return 0;
  return Math.min(1, Math.max(0, (x - left) / width));
}

export interface QueueRow {
  /** Index in der Warteschlange des Feeds, so springt goTo dorthin */
  index: number;
  id: string;
  area: Area;
  hook: string;
  current: boolean;
}

/** Der laufende Moment zuerst, dahinter die nächsten, höchstens max Zeilen. Fehlende Einträge werden nicht erfunden. */
export function upNext(queue: readonly Moment[], idx: number, max = QUEUE_SHOWN): QueueRow[] {
  const out: QueueRow[] = [];
  for (let i = Math.max(0, idx); i < queue.length && out.length < max; i++) {
    const m = queue[i];
    out.push({ index: i, id: m.id, area: m.area, hook: m.hook, current: i === idx });
  }
  return out;
}

/** Zahl der Momente hinter dem laufenden, die schon in der Warteschlange stehen */
export const queuedAfter = (queue: readonly unknown[], idx: number): number => Math.max(0, queue.length - Math.max(0, idx) - 1);

/** Untertitelfeld: aktuelle und vorige Zeile aus den Cues, nichts erfunden. Index -1 oder -2: noch keine Zeile. */
export function lyricLines(cues: readonly [number, string][] | undefined, i: number): { prev: string; cur: string } {
  if (!cues || i < 0 || i >= cues.length) return { prev: '', cur: '' };
  const prev = i > 0 ? cues[i - 1][1].trim() : '';
  return { prev, cur: cues[i][1].trim() };
}

/** Kürzel in der Tastaturhilfe rechts, je Reiter. Text hat keinen Player, darum nur Blättern. */
export function keyHints(form: 'video' | 'audio' | 'text', hasCaptions: boolean, seekable: boolean): { label: string; keys: string }[] {
  if (form === 'text') {
    return [
      { label: 'Next, previous', keys: '↓ ↑' },
      { label: 'Video, Audio, Text', keys: '1 2 3' },
    ];
  }
  const rows = [
    { label: 'Pause or play', keys: 'Space' },
    { label: 'Next, previous', keys: '↓ ↑' },
  ];
  if (seekable) rows.push({ label: '10 s forward, back', keys: '→ ←' });
  rows.push({ label: 'Video, Audio, Text', keys: '1 2 3' });
  if (hasCaptions) rows.push({ label: 'Captions', keys: 'C' });
  return rows;
}

/** Größe der Hook-Überschrift in der Mitte nach Zeichenzahl: l 32 px, m 26 px, s 22 px. Der Hook wird nie gekürzt, nur kleiner gesetzt. */
export function hookSize(text: string): 'l' | 'm' | 's' {
  const n = text.trim().length;
  return n <= 80 ? 'l' : n <= 150 ? 'm' : 's';
}

/** Beschriftung des Knopfs "Quelle öffnen" je Reiter */
export const openLabel = (form: 'video' | 'audio' | 'text'): string => (form === 'audio' ? 'Open full episode' : form === 'video' ? 'Open full video' : 'Open source');
