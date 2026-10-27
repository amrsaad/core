/**
 * Rückmeldung zu einem Moment (Aufgabe 5, Max 27.10.2026). Chips und Freitext werden lokal gespeichert,
 * "Send" öffnet eine vorausgefüllte GitHub-Issue-Seite im Browser des Geräts. Kein Token, kein Netzwerkaufruf der App.
 * Reine Regeln, gleiche in ios/Core/Round1.swift (Note). Gleiche Prüfdaten in tests/moments-note.test.ts und Round1Tests.
 */
export const CHIPS = ['Known', 'Boring', 'Wrong', 'Bad cut', 'Bad audio', 'Bad captions', 'Great'] as const;
export type Chip = (typeof CHIPS)[number];
export const ISSUE_BASE = 'https://github.com/amrsaad/core-content/issues/new';
export const ISSUE_LABEL = 'feedback';
/** Freitext wird für die Adresse auf diese Länge gesetzt (Adressen über etwa 8000 Zeichen nimmt GitHub nicht an) */
export const TEXT_MAX = 1500;

/** Chip an- oder abwählen, die Reihenfolge bleibt die der Liste */
export const toggleChip = (chips: Chip[], c: Chip): Chip[] => CHIPS.filter((x) => (x === c ? !chips.includes(c) : chips.includes(x)));

/** Wrong und Known wirken wie das bisherige Menü. Wrong geht vor Known. */
export const noteEffect = (chips: Chip[]): 'falsch' | 'kenne' | null => (chips.includes('Wrong') ? 'falsch' : chips.includes('Known') ? 'kenne' : null);

export interface NoteContext {
  id: string;
  videoId: string;
  start: number;
  end: number;
  channel: string;
  sourceUrl: string;
  area: string;
  tab: string;
  speed: number;
  device: string;
  commit: string;
  hook: string;
}

const num = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));

export function issueBody(c: NoteContext, chips: Chip[], text: string): string {
  return [
    `Moment: ${c.id}`,
    `Video: ${c.videoId}`,
    `Start: ${Math.round(c.start)} s`,
    `End: ${Math.round(c.end)} s`,
    `Source: ${c.channel}, ${c.sourceUrl}`,
    `Area: ${c.area}`,
    `Tab: ${c.tab}`,
    `Speed: ${num(c.speed)}x`,
    `Device: ${c.device}`,
    `App: ${c.commit}`,
    `Chips: ${chips.length ? chips.join(', ') : 'none'}`,
    '',
    text.trim().slice(0, TEXT_MAX),
  ].join('\n');
}

/** Wie encodeURIComponent, dazu ! ' ( ) * kodiert, damit Web und iPhone dieselbe Adresse bauen */
export const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase());

export function issueUrl(c: NoteContext, chips: Chip[], text: string): string {
  return `${ISSUE_BASE}?title=${enc(c.hook)}&body=${enc(issueBody(c, chips, text))}&labels=${ISSUE_LABEL}`;
}

/** Kurze Gerätezeile aus dem User-Agent: "iPhone, iOS 17.5, Safari" */
export function deviceLine(ua: string): string {
  const ios = ua.match(/(iPhone|iPad).*?OS (\d+)[_.](\d+)/);
  const os = ios ? `${ios[1]}, iOS ${ios[2]}.${ios[3]}` : /Android (\d+)/.test(ua) ? `Android ${ua.match(/Android (\d+)/)![1]}` : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'unknown device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Firefox\/|FxiOS/.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'browser';
  return `${os}, ${br}`;
}
