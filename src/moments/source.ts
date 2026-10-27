import type { Moment } from './types';

// Quellenzeile unter der Passage der Textform (Aufgabe 6). Gleiche Regeln und Prüfdaten in ios/Core/Round1.swift (SourceLine).

export interface SourceLine {
  /** "Quoted from " bei vorbehaltenen Rechten, sonst leer */
  prefix: string;
  /** Autor, Quelle, Fundstelle, Lizenz, getrennt durch Komma */
  text: string;
  /** Link auf die Quelle, fehlt er, ist die Zeile nicht antippbar */
  url: string | null;
}

export const RESERVED = /alle rechte vorbehalten|all rights reserved/i;

export function isReserved(license: string | undefined): boolean {
  return !!license && RESERVED.test(license);
}

type Src = Pick<Moment, 'author' | 'channel' | 'ref' | 'license' | 'sourceUrl'>;

export function sourceLine(m: Src): SourceLine | null {
  const reserved = isReserved(m.license);
  const license = reserved ? 'All rights reserved' : (m.license ?? '').trim();
  const author = (m.author ?? '').trim();
  const source = (m.channel ?? '').trim();
  const parts = [author, source && source !== author ? source : '', (m.ref ?? '').trim(), license].filter(Boolean);
  if (!parts.length) return null;
  const url = /^https?:\/\//i.test(m.sourceUrl ?? '') ? (m.sourceUrl as string) : null;
  return { prefix: reserved ? 'Quoted from ' : '', text: parts.join(', '), url };
}
