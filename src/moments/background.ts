// Hintergrund-Wiedergabe (Entscheidung 13 in core-content/docs/fundament.md). Dieselben Regeln wie ios/Core/BackgroundAudio.swift.
// Audio-Reiter: der Ton läuft weiter, am Ende kommt der nächste Moment aus der Mischung (Web: Versuch, keine Zusage).
// Video-Reiter: ein eigener Stream läuft bis zum Ende des Moments und stoppt dann. YouTube und Text pausieren.
import type { Moment } from './types';
import type { Form } from './form';

/** Seite verlassen: Ton eigener Streams bleibt, YouTube und Text halten an */
export type LeaveAction = 'keepSound' | 'pause';
export const onLeave = (form: Form, isYouTube: boolean): LeaveAction => (isYouTube || form === 'text' ? 'pause' : 'keepSound');

/** Ende eines Moments: im Vordergrund wie immer weiter, im Hintergrund nur der Audio-Reiter, sonst Stopp */
export type EndAction = 'advance' | 'stop';
export const atEnd = (form: Form, inBackground: boolean): EndAction => (!inBackground || form === 'audio' ? 'advance' : 'stop');

/** Gesehen zählt beim Start nur im Vordergrund. Im Hintergrund zählt erst das Ende (ended). */
export const countsSeenAtStart = (inBackground: boolean): boolean => !inBackground;

export const isBackground = (visibility: string): boolean => visibility === 'hidden';

/** Jeder Moment zählt sein Ende höchstens einmal, auch nach der Rückkehr in den Vordergrund */
export class EndLedger {
  private done = new Set<string>();
  /** true beim ersten Mal */
  first(id: string): boolean {
    if (this.done.has(id)) return false;
    this.done.add(id);
    return true;
  }
}

/** Nächster Moment nach id in der Warteschlange der Mischung: dieselbe Reihenfolge wie beim Wisch, kein eigener Algorithmus */
export function nextIn(queue: readonly Moment[], id: string | undefined): Moment | undefined {
  if (!id) return undefined;
  const i = queue.findIndex((m) => m.id === id);
  return i >= 0 ? queue[i + 1] : undefined;
}
export function previousIn(queue: readonly Moment[], id: string | undefined): Moment | undefined {
  if (!id) return undefined;
  const i = queue.findIndex((m) => m.id === id);
  return i > 0 ? queue[i - 1] : undefined;
}

/** Wartezeit, bis ein Auto-Weiter im Hintergrund als gescheitert gilt (der Browser verweigert Play ohne Geste) */
export const BG_STALL_MS = 4000;

/** Zeile für die Diagnose: wie oft started, ended und next im Protokoll stehen */
export function backgroundLine(lines: readonly string[]): string {
  const n = (key: string) => lines.filter((l) => l.startsWith(`bg: ${key} `)).length;
  return `background: started ${n('started')}, ended ${n('ended')}, next ${n('next')}`;
}
