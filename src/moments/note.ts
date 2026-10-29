/**
 * Rückmeldung zu einem Moment (Auftrag Max 27.10.2026, ersetzt Aufgabe 5). Eine Ebene: Wisch nach links öffnet ein Blatt mit
 * sieben Chips und einem Textfeld mit Done. Ein Tipp auf einen Chip speichert sofort lokal. Es gibt keinen Send-Knopf.
 * Notizen sammeln sich lokal. Beim ersten Öffnen am Tag, wenn ungesendete Notizen vorliegen, steht eine Zeile "N notes, send?"
 * im Feed. Ein Tipp darauf öffnet ein einziges vorausgefülltes Issue in core-content, danach gelten die Notizen als gesendet.
 * Kein Token, kein Netzwerkaufruf der App. Reine Regeln, gleiche in ios/Core/Round1.swift (Note).
 * Gleiche Prüfdaten in tests/moments-note.test.ts und ios/CoreTests/Round1Tests.swift.
 */
import type { Effect } from './learn';

export const CHIPS = ['Known', 'Not for me', 'Wrong', 'Boring', 'Bad cut', 'Great', 'Mute speaker'] as const;
export type Chip = (typeof CHIPS)[number];
export const ISSUE_BASE = 'https://github.com/amrsaad/core-content/issues/new';
export const ISSUE_LABEL = 'feedback';
/** Freitext je Notiz, damit viele Notizen in eine Adresse passen */
export const TEXT_MAX = 400;
/** Adressen über etwa 8000 Zeichen nimmt GitHub nicht an. Darunter bleiben wir mit Reserve. */
export const URL_MAX = 7000;
/** Gesendete Notizen bleiben so lange lokal (Tage), dann fallen sie heraus */
export const SENT_KEEP_DAYS = 30;

export interface NoteEntry {
  /** eindeutig je Notiz: Moment-ID und Zeitpunkt */
  key: string;
  id: string;
  hook: string;
  chips: Chip[];
  text: string;
  /** Reiter zum Zeitpunkt der Notiz: Video, Audio oder Text */
  tab: string;
  /** App-Commit zum Zeitpunkt der Notiz */
  commit: string;
  at: number;
  /** Zeitpunkt, an dem die Notiz in ein Issue ging. Fehlt, solange sie ungesendet ist. */
  sent?: number;
}

/**
 * Was ein Chip sofort lernt (Regeln und Zahlen in learn.ts). Known = Already known, Boring = Weak. Bad cut und Great speichern nur.
 * Nach jedem Chip steht am Blatt eine Bestätigungszeile (learn.ts confirmLine).
 */
export const chipEffect = (c: Chip): Effect | null => (c === 'Known' ? 'known' : c === 'Wrong' ? 'wrong' : c === 'Mute speaker' ? 'mute' : c === 'Not for me' ? 'notForMe' : c === 'Boring' ? 'weak' : null);

/** Wie lange die Bestätigungszeile am Blatt steht, bevor es schließt und der Feed zum nächsten Moment geht (ms) */
export const CONFIRM_SHEET_MS = 900;

export interface NoteContext {
  id: string;
  hook: string;
  tab: string;
  commit: string;
}

/** Neue Notiz aus Chips und Text. Ohne Chip und ohne Text gibt es keine Notiz. */
export function makeEntry(c: NoteContext, chips: Chip[], text: string, at: number): NoteEntry | null {
  const t = text.trim().slice(0, TEXT_MAX);
  const ordered = CHIPS.filter((x) => chips.includes(x));
  if (!ordered.length && !t) return null;
  return { key: `${c.id}#${at}`, id: c.id, hook: c.hook, chips: ordered, text: t, tab: c.tab, commit: c.commit, at };
}

export const unsent = (list: NoteEntry[] | undefined): NoteEntry[] => (list ?? []).filter((e) => e.sent === undefined);

/** "1 note, send?" oder "N notes, send?" */
export const promptLine = (n: number): string => `${n} ${n === 1 ? 'note' : 'notes'}, send?`;

/**
 * Erstes Öffnen an diesem Tag? Dann wird der Tag vermerkt, und die Zeile erscheint, wenn ungesendete Notizen vorliegen.
 * Notizen von heute werden also morgen früh angeboten, nicht beim nächsten Öffnen am selben Tag.
 */
export const shouldPrompt = (n: number, lastDay: string | undefined, today: string): boolean => n > 0 && lastDay !== today;
export const firstOpenOfDay = (lastDay: string | undefined, today: string): boolean => lastDay !== today;

export interface Row {
  id: string;
  hook: string;
  chips: Chip[];
  text: string;
  tab: string;
  commit: string;
  keys: string[];
}

/** Notizen zum selben Moment werden eine Zeile: Chips vereint (Reihenfolge der Liste), Texte mit " / " verbunden */
export function rows(list: NoteEntry[]): Row[] {
  const out: Row[] = [];
  for (const e of list) {
    const r = out.find((x) => x.id === e.id);
    if (!r) {
      out.push({ id: e.id, hook: e.hook, chips: [...e.chips], text: e.text, tab: e.tab, commit: e.commit, keys: [e.key] });
      continue;
    }
    r.chips = CHIPS.filter((c) => r.chips.includes(c) || e.chips.includes(c));
    r.text = [r.text, e.text].filter(Boolean).join(' / ');
    r.keys.push(e.key);
  }
  return out;
}

/** Eine Tabellenzelle: kein Zeilenumbruch, kein senkrechter Strich */
const cell = (s: string) => s.replace(/\s*[\r\n]+\s*/g, ' ').replace(/\|/g, '/').trim();

export const HEADER = ['| Moment | Hook | Chips | Text | Tab | App |', '|---|---|---|---|---|---|'];

export function rowLine(r: Row): string {
  return `| ${[r.id, r.hook, r.chips.length ? r.chips.join(', ') : '-', r.text || '-', r.tab, r.commit].map(cell).join(' | ')} |`;
}

export function issueBody(list: Row[]): string {
  return [...HEADER, ...list.map(rowLine)].join('\n');
}

export function issueTitle(day: string, n: number): string {
  return `Core feedback ${day}, ${n} ${n === 1 ? 'moment' : 'moments'}`;
}

/** Wie encodeURIComponent, dazu ! ' ( ) * kodiert, damit Web und iPhone dieselbe Adresse bauen */
export const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase());

export function issueUrl(title: string, body: string): string {
  return `${ISSUE_BASE}?title=${enc(title)}&body=${enc(body)}&labels=${ISSUE_LABEL}`;
}

export interface Built {
  url: string;
  /** Schlüssel der Notizen, die in diesem Issue stehen */
  keys: string[];
  rows: number;
}

/**
 * Ein einziges Issue aus allen ungesendeten Notizen, älteste zuerst. Passt nicht alles in die Adresse, kommen so viele Zeilen
 * hinein wie passen (mindestens eine). Der Rest bleibt ungesendet und geht beim nächsten Mal.
 */
export function buildIssue(list: NoteEntry[], day: string): Built | null {
  const all = rows(list);
  if (!all.length) return null;
  let k = all.length;
  const make = (n: number) => issueUrl(issueTitle(day, n), issueBody(all.slice(0, n)));
  while (k > 1 && make(k).length > URL_MAX) k--;
  const used = all.slice(0, k);
  return { url: make(k), keys: used.flatMap((r) => r.keys), rows: k };
}

/** Gesendet markieren und alte gesendete Notizen entfernen */
export function markSent(list: NoteEntry[] | undefined, keys: string[], at: number): NoteEntry[] {
  const cutoff = at - SENT_KEEP_DAYS * 86_400_000;
  return (list ?? []).map((e) => (keys.includes(e.key) ? { ...e, sent: at } : e)).filter((e) => e.sent === undefined || e.sent >= cutoff);
}
