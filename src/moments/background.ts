// Hintergrund-Wiedergabe (Entscheidung 13 in core-content/docs/fundament.md, Web seit Issue 11). Dieselben Regeln wie ios/Core/BackgroundAudio.swift.
// Audio-Reiter: der Ton läuft weiter, am Ende kommt der nächste Moment aus der Mischung. Im Web wechselt das eine dauerhafte Audio-Element
// die Quelle synchron im Ende-Handler (src/video/audioDeck.ts), der Nachfolger steht vorher fest (successorOf).
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

/**
 * Nachfolger für Wisch und Auto-Weiter: der erste Moment hinter idx, der nicht gescheitert ist. goTo nimmt gescheiterte Momente aus dem Rest der
 * Warteschlange, danach steht dieser Moment an Stelle idx + 1. Der Audio-Reiter berechnet ihn vor dem Ende, damit im Ende-Handler nur src und play bleiben.
 */
export function successorOf<T extends { videoId: string }>(queue: readonly T[], idx: number, bad: ReadonlySet<string>): T | undefined {
  for (let j = idx + 1; j < queue.length; j++) if (!bad.has(queue[j].videoId)) return queue[j];
  return undefined;
}

/** Zeile für die Diagnose: wie oft started, ended, next und rejected (play vom Browser verweigert) im Protokoll stehen */
export function backgroundLine(lines: readonly string[]): string {
  const n = (key: string) => lines.filter((l) => l.startsWith(`bg: ${key} `)).length;
  return `background: started ${n('started')}, ended ${n('ended')}, next ${n('next')}, rejected ${n('play rejected')}`;
}
