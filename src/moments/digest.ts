/**
 * Core Digest (fundament.md Entscheidung 12 in core-content): die Wochenkarte oben im Saved-Reiter.
 * Die Datei docs/digest/latest.json entsteht wöchentlich in core-content und liegt verschlüsselt als state/digest-latest.enc.
 * Die App liest sie über den Sync-Weg. Taps (Done, Drop, Option A oder B) landen im Zustand (digestTaps), wandern per Sync
 * und werden vom nächsten Lauf eingesammelt. Reine Funktionen, gleiche Regeln in ios/Core/Digest.swift.
 */
export const DIGEST_KINDS = ['action', 'habit', 'rule', 'know', 'research', 'content', 'script', 'source', 'contradiction'] as const;
export type DigestKind = (typeof DIGEST_KINDS)[number];

export interface DigestAction {
  id: string;
  title: string;
  metric: string;
  /** YYYY-MM-DD */
  due: string;
  url: string | null;
}

export interface DigestContradiction {
  id: string;
  otherId: string;
  question: string;
  /** Knopf Option A: gilt dieser Save */
  a: string;
  /** Knopf Option B: gilt der andere */
  b: string;
}

export interface DigestLatest {
  v: 1;
  /** z.B. 2026-W44 */
  week: string;
  /** ISO-Zeit des Laufs */
  generatedAt: string;
  saves: number;
  counts: Record<DigestKind, number>;
  actions: DigestAction[];
  contradictions: DigestContradiction[];
}

export type TapChoice = 'done' | 'drop' | 'a' | 'b';
export interface DigestTap {
  choice: TapChoice;
  /** ms */
  at: number;
}
export type DigestTaps = Record<string, DigestTap>;

/** Schlüssel in digestTaps und im Lauf: a:<id> für Action, c:<id> für Contradiction */
export const tapKey = {
  action: (id: string) => `a:${id}`,
  contradiction: (id: string) => `c:${id}`,
};

const str = (v: unknown): v is string => typeof v === 'string';

/** Prüft die Form der Datei, damit eine fehlerhafte oder neuere Fassung die App nie zum Absturz bringt. null = unbrauchbar. */
export function parseLatest(raw: unknown): DigestLatest | null {
  const j = raw as Partial<DigestLatest> | null;
  if (!j || typeof j !== 'object' || j.v !== 1 || !str(j.week) || !str(j.generatedAt) || Number.isNaN(Date.parse(j.generatedAt))) return null;
  const counts = {} as Record<DigestKind, number>;
  for (const k of DIGEST_KINDS) {
    const n = (j.counts as Record<string, unknown> | undefined)?.[k];
    counts[k] = typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  }
  const actions = (Array.isArray(j.actions) ? j.actions : []).filter((a): a is DigestAction => !!a && str(a.id) && str(a.title) && str(a.metric) && str(a.due)).map((a) => ({ id: a.id, title: a.title, metric: a.metric, due: a.due, url: str(a.url) ? a.url : null }));
  const contradictions = (Array.isArray(j.contradictions) ? j.contradictions : []).filter((c): c is DigestContradiction => !!c && str(c.id) && str(c.otherId) && str(c.question) && str(c.a) && str(c.b)).map((c) => ({ id: c.id, otherId: c.otherId, question: c.question, a: c.a, b: c.b }));
  return { v: 1, week: j.week, generatedAt: j.generatedAt, saves: typeof j.saves === 'number' && j.saves >= 0 ? Math.floor(j.saves) : 0, counts, actions, contradictions };
}

const ACTION_CHOICES: TapChoice[] = ['done', 'drop'];
const CONTRA_CHOICES: TapChoice[] = ['a', 'b'];

/** Tap setzen oder ändern. Gleiche Wahl noch einmal: bleibt, nichts ändert sich (gleicher Verweis). */
export function setTap(taps: DigestTaps | undefined, key: string, choice: TapChoice, now: number): DigestTaps {
  const cur = taps ?? {};
  const allowed = key.startsWith('a:') ? ACTION_CHOICES : key.startsWith('c:') ? CONTRA_CHOICES : [];
  if (!allowed.includes(choice) || cur[key]?.choice === choice) return cur;
  return { ...cur, [key]: { choice, at: now } };
}

export const actionTap = (taps: DigestTaps | undefined, id: string): TapChoice | undefined => taps?.[tapKey.action(id)]?.choice;
export const contradictionTap = (taps: DigestTaps | undefined, id: string): TapChoice | undefined => taps?.[tapKey.contradiction(id)]?.choice;

/** Actions ohne Tap */
export const openActions = (latest: DigestLatest | undefined, taps: DigestTaps | undefined): number => (latest ? latest.actions.filter((a) => !actionTap(taps, a.id)).length : 0);

/** Arten mit Zahl größer 0, in fester Reihenfolge */
export const countList = (latest: DigestLatest): { kind: DigestKind; n: number }[] => DIGEST_KINDS.filter((k) => latest.counts[k] > 0).map((kind) => ({ kind, n: latest.counts[kind] }));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Oct 29" in der lokalen Zeit des Geräts */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
/** YYYY-MM-DD als "Nov 9" ohne Zeitzonenverschiebung */
export function dueDate(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}` : day;
}

/** Zeile in den Einstellungen */
export function lastDigestLine(latest: DigestLatest | undefined, taps: DigestTaps | undefined): string {
  if (!latest) return 'Last digest: none yet';
  const n = openActions(latest, taps);
  return `Last digest: ${shortDate(latest.generatedAt)}, ${n} ${n === 1 ? 'action' : 'actions'} open`;
}
