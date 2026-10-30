/**
 * Rückmeldung zu einem Moment (Auftrag Max 27.10.2026, ersetzt Aufgabe 5). Eine Ebene: Wisch nach links öffnet ein Blatt mit
 * sechs Chips und einem Textfeld mit Done. Ein Tipp auf einen Chip speichert sofort lokal. Es gibt keinen Send-Knopf.
 * Notizen sammeln sich lokal. Beim ersten Öffnen am Tag, wenn ungesendete Notizen vorliegen, steht eine Zeile "N notes, send?"
 * im Feed. Ein Tipp darauf öffnet ein einziges vorausgefülltes Issue in core-content, danach gelten die Notizen als gesendet.
 * Kein Token, kein Netzwerkaufruf der App. Reine Regeln, gleiche in ios/Core/Round1.swift (Note).
 * Gleiche Prüfdaten in tests/moments-note.test.ts und ios/CoreTests/Round1Tests.swift.
 *
 * Source und Topic (Entscheidung 20, Max 30.10.2026): zwei weitere Chips im Blatt. Ein Tipp öffnet ein Textfeld (Link oder Name bzw. Thema), Absenden legt
 * eine Notiz ohne Chip an, deren Text mit "source:" bzw. "topic:" beginnt. Beim Senden wird nach diesem Präfix getrennt. Jede solche Notiz wird ein eigenes
 * Issue mit Label source bzw. topic und steht nicht im Sammel-Issue der normalen Notizen. Ein Tipp auf die Zeile "N notes, send?" öffnet das nächste Issue.
 * Nur Web (Entscheidung 14), die iOS-Regeln bleiben unverändert.
 */
import type { Effect } from './learn';

export const CHIPS = ['Already known', 'Not for me', 'Weak', 'Wrong', 'Bad cut', 'Mute speaker'] as const;
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
 * Was ein Chip sofort lernt (Regeln und Zahlen in learn.ts). Already known = bisher Known, Weak = bisher Boring. Bad cut speichert nur.
 * Nach jedem Chip steht am Blatt eine Bestätigungszeile (learn.ts confirmLine).
 */
export const chipEffect = (c: Chip): Effect | null => (c === 'Already known' ? 'known' : c === 'Wrong' ? 'wrong' : c === 'Mute speaker' ? 'mute' : c === 'Not for me' ? 'notForMe' : c === 'Weak' ? 'weak' : null);

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
  /** Art des Issues. Fehlt bei Aufrufern, die nur das Sammel-Issue kennen. */
  kind?: NoteKind;
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
  const all = rows(splitNotes(list).feedback);
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

// ---------- Source und Topic (Entscheidung 20) ----------

export const INPUT_CHIPS = ['Source', 'Topic'] as const;
export type InputChip = (typeof INPUT_CHIPS)[number];
export type NoteKind = 'feedback' | 'source' | 'topic';
export const INPUT_PREFIX: Record<InputChip, string> = { Source: 'source:', Topic: 'topic:' };
export const INPUT_LABEL: Record<InputChip, string> = { Source: 'Source: link or name', Topic: 'Topic' };
export const INPUT_HINT: Record<InputChip, string> = { Source: 'Link or name', Topic: 'Topic' };
export const INPUT_BUTTON = 'Add';
/** Längster Wert im Textfeld, damit Präfix und Wert in TEXT_MAX passen */
export const INPUT_MAX = TEXT_MAX - Math.max(...INPUT_CHIPS.map((c) => INPUT_PREFIX[c].length)) - 1;
/** Bestätigungszeile am Blatt, wie bei den anderen Chips */
export const inputConfirm = (c: InputChip): string => `${c} noted`;
/** Titel eines Issues ohne Umbruch, höchstens so lang */
export const ISSUE_TITLE_MAX = 120;

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
const PREFIX_RE = /^\s*(source|topic):\s*(\S[\s\S]*)$/i;

/** Notiz aus dem Textfeld von Source oder Topic: Text "source: <Wert>" ohne Chip. Ein leerer Wert gibt keine Notiz. */
export function makeInputEntry(c: NoteContext, chip: InputChip, value: string, at: number): NoteEntry | null {
  const v = oneLine(value).slice(0, INPUT_MAX).trim();
  if (!v) return null;
  return makeEntry(c, [], `${INPUT_PREFIX[chip]} ${v}`, at);
}

/** Art einer Notiz. Source und Topic nur ohne Chip und mit Präfix am Textanfang, alles andere ist normale Rückmeldung. */
export function kindOf(e: NoteEntry): NoteKind {
  if (e.chips.length === 0) {
    const m = PREFIX_RE.exec(e.text);
    if (m) return m[1].toLowerCase() as NoteKind;
  }
  return 'feedback';
}

/** Wert hinter dem Präfix, ohne Umbruch */
export const inputValue = (e: NoteEntry): string => oneLine(PREFIX_RE.exec(e.text)?.[2] ?? e.text);

/** Aufteilung nach Art, Reihenfolge der Liste bleibt */
export function splitNotes(list: NoteEntry[]): { feedback: NoteEntry[]; source: NoteEntry[]; topic: NoteEntry[] } {
  const out = { feedback: [] as NoteEntry[], source: [] as NoteEntry[], topic: [] as NoteEntry[] };
  for (const e of list) out[kindOf(e)].push(e);
  return out;
}

/** Ein eigenes Issue für eine Source- oder Topic-Notiz: Titel "source: <Wert>", Label source bzw. topic, Body mit Wert und Herkunft */
export function inputIssue(e: NoteEntry): Built {
  const kind = kindOf(e) as 'source' | 'topic';
  const value = inputValue(e);
  const title = `${kind}: ${value}`.slice(0, ISSUE_TITLE_MAX).trim();
  const body = [value, '', `Heard in: ${e.id}`, `Hook: ${oneLine(e.hook)}`, `Tab: ${e.tab}`, `App: ${e.commit}`].join('\n');
  return { kind, url: `${ISSUE_BASE}?title=${enc(title)}&body=${enc(body)}&labels=${kind}`, keys: [e.key], rows: 1 };
}

/**
 * Das nächste Issue aus den ungesendeten Notizen. Zuerst das Sammel-Issue der normalen Rückmeldungen (wie bisher), danach je eine Source- oder
 * Topic-Notiz, älteste zuerst. Der Browser öffnet pro Tipp nur ein Fenster, deshalb bleibt die Zeile "N notes, send?" stehen, bis nichts mehr offen ist.
 */
export function nextIssue(list: NoteEntry[], day: string): Built | null {
  const parts = splitNotes(list);
  const fb = buildIssue(parts.feedback, day);
  if (fb) return { ...fb, kind: 'feedback' };
  const next = [...parts.source, ...parts.topic].sort((a, b) => a.at - b.at)[0];
  return next ? inputIssue(next) : null;
}
