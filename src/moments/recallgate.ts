/**
 * Abstand der Abrufkarten (Runde 34): eine Karte nach je RECALL_EVERY im Vordergrund gespielten Momenten.
 * Hintergrund-Momente zählen nicht. Direkt nach der Rückkehr aus dem Hintergrund kommt keine Karte, erst nachdem danach ein Moment
 * im Vordergrund gehört wurde. Nichts wird vorgemerkt: geht eine fällige Karte nicht, bleibt der Zähler und der nächste Wisch versucht es neu.
 * Reine Funktionen, der Zähler gilt nur für die laufende Sitzung.
 */
import { cardDue } from './recall';

export interface Gate {
  /** im Vordergrund gespielte Momente seit der letzten gezeigten Karte */
  played: number;
  /** gerade aus dem Hintergrund zurück, danach noch kein Moment im Vordergrund gehört */
  hold: boolean;
}

export const newGate = (): Gate => ({ played: 0, hold: false });

/** Seite kommt aus dem Hintergrund zurück */
export const gateBack = (g: Gate): Gate => ({ ...g, hold: true });

/** Eine Karte wurde gezeigt: Zähler auf null */
export const gateShown = (g: Gate): Gate => ({ ...g, played: 0 });

/**
 * Vorwärts-Wechsel weg von einem Moment. heard: der Moment lief im Vordergrund (Seite nie verdeckt) und gilt nach played.ts als gespielt,
 * und wurde in dieser Sitzung noch nicht gezählt. due: jetzt darf eine Karte gewählt werden. held: sie wäre fällig, wird aber wegen der Rückkehr gehalten.
 */
export function gateLeave(g: Gate, heard: boolean): { gate: Gate; due: boolean; held: boolean } {
  const gate: Gate = heard ? { played: g.played + 1, hold: false } : g;
  const wants = cardDue(gate.played);
  return { gate, due: wants && !gate.hold, held: wants && gate.hold };
}
