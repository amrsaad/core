/**
 * Geräte-Sync (Auftrag Max 28.10.2026): der Nutzungsstand als ein Dokument, das zwei Geräte zusammenführen.
 * Reine Funktionen, gleiche Regeln in ios/Core/Sync.swift, gleiche Prüfdaten in tests/fixtures/sync-vectors.json
 * und tests/fixtures/sync-random.json. Die Zusammenführung ist vertauschbar, wiederholbar und gruppierbar
 * (merge(a,b) = merge(b,a), merge(a,a) = a), darum konvergieren beliebig viele Geräte in beliebiger Reihenfolge.
 *
 * Regeln:
 * - Mengen werden vereinigt: gesehen (frühester Zeitpunkt), Protokoll (je Moment und Tag, Weitergeschautes und Ende bleiben), Notizen (je Schlüssel, "gesendet" bleibt).
 * - Gewichte (mit ihren Abläufen, siehe moments/learn.ts), gemerkte Momente, Herzen, stummgeschaltete Sprecher, Pläne und Einstellungen gelten je Schlüssel nach dem jüngsten Zeitstempel (`ts`).
 *   Auch ein Löschen bekommt einen Zeitstempel, sonst käme ein weggenommener Eintrag vom anderen Gerät zurück. Ohne Zeitstempel (alter Stand) gewinnt, was da ist.
 * - Taps auf der Wochenkarte (Core Digest): je Schlüssel nach dem jüngsten Zeitstempel, bei Gleichstand der spätere Tap, dann die größere Wahl.
 * - Abruftermine: Ergebnisse vereinigt, der Termin kommt vom Eintrag mit dem jüngsten Ergebnis (bei Gleichstand der spätere Termin).
 * - Zähler je Tag (Tageszahl, Zeit im Feed): der größere Wert.
 */
import type { AppState, SavedMoment, Settings } from '../state';
import type { Weights } from '../../moments/mix';
import type { Moment, MomentLogEntry } from '../../moments/types';
import type { DayCount } from '../../moments/today';
import { DAY_KEEP } from '../../moments/today';
import type { RecallItem, RecallResult, RecallState } from '../../moments/recall';
import type { NoteEntry } from '../../moments/note';
import type { WeekPlan } from '../../moments/review';
import { parseUntilKey, type Until } from '../../moments/learn';
import type { DigestTap } from '../../moments/digest';

export const SYNC_VERSION = 1;
/** wie LOG_MAX in MomentFeed.tsx */
export const LOG_MAX = 3000;
/** Einstellungen, die zwischen Geräten wandern. playerMode, captions und alles Messtechnische bleibt am Gerät. */
export const SYNC_SETTINGS = ['areaShares', 'captionMode', 'form', 'playbackSpeed'] as const;
export type SyncSettingKey = (typeof SYNC_SETTINGS)[number];
export type SyncSettings = Partial<Pick<Settings, SyncSettingKey>>;

export interface SyncState {
  momentSeen: Record<string, number>;
  momentLog: MomentLogEntry[];
  dayCount: Record<string, DayCount>;
  savedMoments: Record<string, SavedMoment>;
  momentWeights: Weights;
  recall: RecallState;
  feedbackNotes: NoteEntry[];
  notesPromptDay?: string;
  momentDay?: string;
  momentLiked: Record<string, number>;
  mutedChannels: Record<string, string>;
  feedTime: Record<string, number>;
  weekReviewShown: Record<string, boolean>;
  plans: Record<string, WeekPlan>;
  digestTaps: Record<string, DigestTap>;
  settings: SyncSettings;
}

export interface SyncDoc {
  v: number;
  state: SyncState;
  /** Zeitpunkt der letzten Änderung je Schlüssel (ms), auch für Löschungen. Schlüssel siehe tsKey. */
  ts: Record<string, number>;
}

export const emptyDoc = (): SyncDoc => ({
  v: SYNC_VERSION,
  state: {
    momentSeen: {},
    momentLog: [],
    dayCount: {},
    savedMoments: {},
    momentWeights: { area: {}, channel: {}, topic: {} },
    recall: {},
    feedbackNotes: [],
    momentLiked: {},
    mutedChannels: {},
    feedTime: {},
    weekReviewShown: {},
    plans: {},
    digestTaps: {},
    settings: {},
  },
  ts: {},
});

// ---------- Zeitstempel-Schlüssel ----------

export const tsKey = {
  weight: (fam: keyof Weights, k: string) => `w:${fam}:${k}`,
  saved: (id: string) => `saved:${id}`,
  liked: (id: string) => `liked:${id}`,
  muted: (ch: string) => `muted:${ch}`,
  plan: (week: string) => `plan:${week}`,
  setting: (k: string) => `set:${k}`,
  digest: (k: string) => `digest:${k}`,
};

// ---------- Hilfen ----------

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const num = (x: number | undefined) => x ?? 0;

/** Stabile Darstellung mit sortierten Schlüsseln, undefined fällt weg. Grundlage für Vergleiche. */
export function canon(v: unknown): string {
  return JSON.stringify(sortDeep(v));
}
function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) o[k] = sortDeep(x);
    }
    return o;
  }
  return v;
}

/** Schlüssel je Zeitstempel: der jüngere gewinnt, bei Gleichstand "vorhanden" vor "gelöscht", bei beiden vorhanden die Zusammenführung der Werte */
function lww<T>(a: Record<string, T> | undefined, b: Record<string, T> | undefined, tsA: Record<string, number>, tsB: Record<string, number>, key: (k: string) => string, combine: (x: T, y: T, k: string) => T): Record<string, T> {
  const out: Record<string, T> = {};
  const A = a ?? {};
  const B = b ?? {};
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
    const ta = num(tsA[key(k)]);
    const tb = num(tsB[key(k)]);
    const ha = k in A;
    const hb = k in B;
    if (ha && hb) out[k] = ta > tb ? A[k] : tb > ta ? B[k] : combine(A[k], B[k], k);
    else if (ha) {
      if (ta >= tb) out[k] = A[k];
    } else if (tb >= ta) out[k] = B[k];
  }
  return out;
}

const maxMap = <T extends number>(a: Record<string, T> | undefined, b: Record<string, T> | undefined): Record<string, T> => {
  const out: Record<string, T> = { ...(a ?? {}) };
  for (const [k, v] of Object.entries(b ?? {})) out[k] = (k in out ? Math.max(out[k], v) : v) as T;
  return out;
};

const maxStr = (a?: string, b?: string) => (a === undefined ? b : b === undefined ? a : cmp(a, b) >= 0 ? a : b);

// ---------- Teile ----------

/** Gewicht bei Gleichstand: das weiter vom Standard 1 entfernte (mehr gelernt), dann das kleinere */
const moreLearned = (a: number, b: number) => {
  const da = Math.abs(Math.log(a));
  const db = Math.abs(Math.log(b));
  return da > db ? a : db > da ? b : Math.min(a, b);
};

/** Ein Ablauf teilt den Zeitstempel-Schlüssel mit dem Gewicht, zu dem er gehört: beide kommen vom selben Gerät */
export const untilTsKey = (key: string): string => {
  const { fam, k } = parseUntilKey(key);
  return tsKey.weight(fam, k);
};

/** Gleichstand zweier Abläufe: der spätere Termin, dann das größere Gewicht danach */
const combineUntil = (x: Until, y: Until): Until => (x.at !== y.at ? (x.at > y.at ? x : y) : x.back >= y.back ? x : y);

function mergeWeights(a: Weights, b: Weights, tsA: Record<string, number>, tsB: Record<string, number>): Weights {
  const fam = (f: 'area' | 'channel' | 'topic') => lww(a[f], b[f], tsA, tsB, (k) => tsKey.weight(f, k), moreLearned);
  const out: Weights = { area: fam('area'), channel: fam('channel'), topic: fam('topic') };
  const until = lww(a.until, b.until, tsA, tsB, untilTsKey, combineUntil);
  if (Object.keys(until).length) out.until = until;
  return out;
}

/** Gleiche ID, aber unterschiedlicher Inhalt (Pool wurde neu gebaut): der mit späterem createdAt, dann längerem excerpt, dann größerem hook. Sonst der erste. */
const pickMoment = (x: Moment, y: Moment): Moment => {
  const c = cmp(x.createdAt ?? '', y.createdAt ?? '') || cmp(x.excerpt ?? '', y.excerpt ?? '') || cmp(x.hook, y.hook);
  return c >= 0 ? x : y;
};

export const combineSaved = (x: SavedMoment, y: SavedMoment): SavedMoment => {
  const out: SavedMoment = { moment: pickMoment(x.moment, y.moment), savedAt: cmp(x.savedAt, y.savedAt) <= 0 ? x.savedAt : y.savedAt };
  if (x.done || y.done) out.done = true;
  return out;
};

/** Gleichzeitig getippt: der spätere Tap, bei gleicher Zeit die größere Wahl */
const combineTap = (x: DigestTap, y: DigestTap): DigestTap => (x.at !== y.at ? (x.at > y.at ? x : y) : cmp(x.choice, y.choice) >= 0 ? x : y);

const combinePlan = (x: WeekPlan, y: WeekPlan): WeekPlan => {
  // Gleichzeitig an zwei Geräten geändert: der größere Text (zuerst when, dann will) gewinnt
  const c = cmp(x.when, y.when) || cmp(x.will, y.will);
  const out: WeekPlan = c >= 0 ? { when: x.when, will: x.will } : { when: y.when, will: y.will };
  const h = x.happened === undefined ? y.happened : y.happened === undefined ? x.happened : x.happened || y.happened;
  if (h !== undefined) out.happened = h;
  return out;
};

/** Das Protokoll hat je Moment und Tag einen Eintrag (MomentFeed.log). Gemeinsame Einträge: Ende zählt, wenn eines es hat, Weitergeschautes das Maximum. */
export function mergeLog(a: MomentLogEntry[], b: MomentLogEntry[]): MomentLogEntry[] {
  const m = new Map<string, MomentLogEntry>();
  for (const e of [...a, ...b]) {
    const k = `${e.day}\u0000${e.id}`;
    const x = m.get(k);
    if (!x) {
      m.set(k, { ...e });
      continue;
    }
    const out: MomentLogEntry = { id: e.id, day: e.day, ended: x.ended || e.ended, watched: Math.max(x.watched, e.watched) };
    const fb = maxStr(x.feedback, e.feedback);
    if (fb !== undefined) out.feedback = fb as MomentLogEntry['feedback'];
    m.set(k, out);
  }
  return [...m.values()].sort((p, q) => cmp(p.day, q.day) || cmp(p.id, q.id)).slice(-LOG_MAX);
}

/** Notizen je Schlüssel, "gesendet" bleibt (der spätere Zeitpunkt) */
export function mergeNotes(a: NoteEntry[], b: NoteEntry[]): NoteEntry[] {
  const m = new Map<string, NoteEntry>();
  for (const e of [...a, ...b]) {
    const x = m.get(e.key);
    if (!x) {
      m.set(e.key, { ...e });
      continue;
    }
    const base = (cmp(x.text, e.text) || cmp(x.hook, e.hook) || cmp(x.commit, e.commit)) >= 0 ? x : e;
    const sent = x.sent === undefined ? e.sent : e.sent === undefined ? x.sent : Math.max(x.sent, e.sent);
    const out: NoteEntry = { ...base };
    if (sent !== undefined) out.sent = sent;
    else delete out.sent;
    m.set(e.key, out);
  }
  return [...m.values()].sort((p, q) => p.at - q.at || cmp(p.key, q.key));
}

const lastAt = (i: RecallItem) => i.results.reduce((mx, r) => Math.max(mx, r.at), 0);

export function mergeRecallItem(x: RecallItem, y: RecallItem): RecallItem {
  const seen = new Set<string>();
  const results: RecallResult[] = [];
  for (const r of [...x.results, ...y.results].sort((p, q) => p.at - q.at || Number(p.got) - Number(q.got))) {
    const k = `${r.at}:${r.got}`;
    if (!seen.has(k)) {
      seen.add(k);
      results.push({ at: r.at, got: r.got });
    }
  }
  // Der Termin gehört zum jüngsten Ergebnis. Gleichstand: der spätere Termin (abgeschlossen = null zählt als kleinster).
  // Maximum über (Zeit des jüngsten Ergebnisses, Termin), damit die Reihenfolge der Zusammenführungen nichts ändert.
  const lx = lastAt(x);
  const ly = lastAt(y);
  const win = lx !== ly ? (lx > ly ? x : y) : (x.due ?? -1) >= (y.due ?? -1) ? x : y;
  return { id: x.id, due: win.due, results };
}

function mergeRecall(a: RecallState, b: RecallState): RecallState {
  const out: RecallState = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out[k] = k in a && k in b ? mergeRecallItem(a[k], b[k]) : k in a ? a[k] : b[k];
  return out;
}

function mergeDayCount(a: Record<string, DayCount>, b: Record<string, DayCount>): Record<string, DayCount> {
  const out: Record<string, DayCount> = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k];
    const y = b[k];
    out[k] = { seen: Math.max(x?.seen ?? 0, y?.seen ?? 0), gotIt: Math.max(x?.gotIt ?? 0, y?.gotIt ?? 0) };
  }
  // wie Today.countSeen: nur die letzten DAY_KEEP Tage
  const keys = Object.keys(out).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - DAY_KEEP))) delete out[k];
  return out;
}

const orMap = (a: Record<string, boolean>, b: Record<string, boolean>): Record<string, boolean> => ({ ...a, ...b });

/** Gleichzeitig an zwei Geräten geändert, gleicher Zeitstempel: Zahl und Text je das Größere, Mix je Bereich der Reihe nach das Größere */
function pickSetting(x: unknown, y: unknown, k: string): unknown {
  if (k === 'areaShares') {
    const p = x as Record<string, number>;
    const q = y as Record<string, number>;
    for (const a of [...new Set([...Object.keys(p), ...Object.keys(q)])].sort()) {
      const d = (p[a] ?? 0) - (q[a] ?? 0);
      if (d !== 0) return d > 0 ? x : y;
    }
    return x;
  }
  if (typeof x === 'number' && typeof y === 'number') return Math.max(x, y);
  return cmp(String(x), String(y)) >= 0 ? x : y;
}

function mergeSettings(a: SyncSettings, b: SyncSettings, tsA: Record<string, number>, tsB: Record<string, number>): SyncSettings {
  return lww(a as Record<string, unknown>, b as Record<string, unknown>, tsA, tsB, tsKey.setting, pickSetting) as SyncSettings;
}

// ---------- Zusammenführen ----------

export function mergeDocs(a: SyncDoc, b: SyncDoc): SyncDoc {
  const x = a.state;
  const y = b.state;
  const out: SyncDoc = {
    v: SYNC_VERSION,
    state: {
      momentSeen: Object.fromEntries(Object.entries(maxMapMin(x.momentSeen, y.momentSeen))),
      momentLog: mergeLog(x.momentLog, y.momentLog),
      dayCount: mergeDayCount(x.dayCount, y.dayCount),
      savedMoments: lww(x.savedMoments, y.savedMoments, a.ts, b.ts, tsKey.saved, combineSaved),
      momentWeights: mergeWeights(x.momentWeights, y.momentWeights, a.ts, b.ts),
      recall: mergeRecall(x.recall, y.recall),
      feedbackNotes: mergeNotes(x.feedbackNotes, y.feedbackNotes),
      momentLiked: lww(x.momentLiked, y.momentLiked, a.ts, b.ts, tsKey.liked, (p, q) => Math.max(p, q)),
      mutedChannels: lww(x.mutedChannels, y.mutedChannels, a.ts, b.ts, tsKey.muted, (p, q) => (cmp(p, q) >= 0 ? p : q)),
      feedTime: maxMap(x.feedTime, y.feedTime),
      weekReviewShown: orMap(x.weekReviewShown, y.weekReviewShown),
      plans: lww(x.plans, y.plans, a.ts, b.ts, tsKey.plan, combinePlan),
      digestTaps: lww(x.digestTaps, y.digestTaps, a.ts, b.ts, tsKey.digest, combineTap),
      settings: mergeSettings(x.settings, y.settings, a.ts, b.ts),
    },
    ts: maxMap(a.ts, b.ts),
  };
  const npd = maxStr(x.notesPromptDay, y.notesPromptDay);
  if (npd !== undefined) out.state.notesPromptDay = npd;
  const md = maxStr(x.momentDay, y.momentDay);
  if (md !== undefined) out.state.momentDay = md;
  return out;
}

/** gesehen: der frühere Zeitpunkt */
function maxMapMin(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = k in out ? Math.min(out[k], v) : v;
  return out;
}

// ---------- Zustand <-> Dokument ----------

export function toDoc(s: AppState): SyncDoc {
  const settings: SyncSettings = {};
  for (const k of SYNC_SETTINGS) if (s.settings[k] !== undefined) (settings as Record<string, unknown>)[k] = s.settings[k];
  const doc: SyncDoc = {
    v: SYNC_VERSION,
    state: {
      momentSeen: s.momentSeen,
      momentLog: s.momentLog,
      dayCount: s.dayCount ?? {},
      savedMoments: s.savedMoments,
      momentWeights: s.momentWeights,
      recall: s.recall ?? {},
      feedbackNotes: s.feedbackNotes ?? [],
      momentLiked: s.momentLiked ?? {},
      mutedChannels: s.mutedChannels,
      feedTime: s.feedTime,
      weekReviewShown: s.weekReviewShown,
      plans: s.plans ?? {},
      digestTaps: s.digestTaps ?? {},
      settings,
    },
    ts: s.syncTs ?? {},
  };
  if (s.notesPromptDay !== undefined) doc.state.notesPromptDay = s.notesPromptDay;
  if (s.momentDay !== undefined) doc.state.momentDay = s.momentDay;
  // Vereinigung mit dem leeren Dokument bringt Reihenfolge und Kürzungen in die gemeinsame Form
  return mergeDocs(doc, emptyDoc());
}

/** Dokument in den Zustand. Nur Felder, die sich ändern, bekommen neue Werte (gleiche Verweise, kein unnötiges Neuzeichnen). */
export function applyDoc(s: AppState, d: SyncDoc): AppState {
  const cur = toDoc(s).state;
  const next = d.state;
  const out: AppState = { ...s };
  const set = <K extends keyof AppState>(k: K, v: AppState[K], same: boolean) => {
    if (!same) out[k] = v;
  };
  const eq = (p: unknown, q: unknown) => canon(p) === canon(q);
  set('momentSeen', next.momentSeen, eq(cur.momentSeen, next.momentSeen));
  set('momentLog', next.momentLog, eq(cur.momentLog, next.momentLog));
  set('dayCount', next.dayCount, eq(cur.dayCount, next.dayCount));
  set('savedMoments', next.savedMoments, eq(cur.savedMoments, next.savedMoments));
  set('momentWeights', next.momentWeights, eq(cur.momentWeights, next.momentWeights));
  set('recall', next.recall, eq(cur.recall, next.recall));
  set('feedbackNotes', next.feedbackNotes, eq(cur.feedbackNotes, next.feedbackNotes));
  set('momentLiked', next.momentLiked, eq(cur.momentLiked, next.momentLiked));
  set('mutedChannels', next.mutedChannels, eq(cur.mutedChannels, next.mutedChannels));
  set('feedTime', next.feedTime, eq(cur.feedTime, next.feedTime));
  set('weekReviewShown', next.weekReviewShown, eq(cur.weekReviewShown, next.weekReviewShown));
  set('plans', next.plans, eq(cur.plans, next.plans));
  set('digestTaps', next.digestTaps, eq(cur.digestTaps, next.digestTaps));
  if (next.notesPromptDay !== undefined && next.notesPromptDay !== s.notesPromptDay) out.notesPromptDay = next.notesPromptDay;
  if (next.momentDay !== undefined && next.momentDay !== s.momentDay) out.momentDay = next.momentDay;
  if (!eq(cur.settings, next.settings)) {
    const settings = { ...s.settings };
    for (const k of SYNC_SETTINGS) {
      if (k in next.settings) (settings as Record<string, unknown>)[k] = next.settings[k];
      else delete settings[k];
    }
    out.settings = settings;
  }
  if (!eq(s.syncTs ?? {}, d.ts)) out.syncTs = d.ts;
  return out;
}

// ---------- Zeitstempel setzen ----------

function diffKeys<T>(prev: Record<string, T> | undefined, next: Record<string, T> | undefined, key: (k: string) => string, ts: Record<string, number>, now: number): boolean {
  if (prev === next) return false;
  const p = prev ?? {};
  const n = next ?? {};
  let changed = false;
  for (const k of new Set([...Object.keys(p), ...Object.keys(n)])) {
    if (k in p !== k in n || (k in n && p[k] !== n[k] && canon(p[k]) !== canon(n[k]))) {
      ts[key(k)] = now;
      changed = true;
    }
  }
  return changed;
}

/**
 * Nach jeder Änderung durch den Nutzer: Schlüssel, die sich geändert haben (auch weggenommene), bekommen die Zeit der Änderung.
 * Zentral an einer Stelle, damit keine einzelne Aktion daran denken muss. Ohne Änderung kommt derselbe Zustand zurück (gleicher Verweis).
 */
export function stampChanges(prev: AppState, next: AppState, now: number): AppState {
  if (prev === next) return next;
  const ts: Record<string, number> = { ...(next.syncTs ?? prev.syncTs ?? {}) };
  let changed = false;
  for (const f of ['area', 'channel', 'topic'] as const) changed = diffKeys(prev.momentWeights?.[f], next.momentWeights?.[f], (k) => tsKey.weight(f, k), ts, now) || changed;
  changed = diffKeys(prev.momentWeights?.until, next.momentWeights?.until, untilTsKey, ts, now) || changed;
  changed = diffKeys(prev.savedMoments, next.savedMoments, tsKey.saved, ts, now) || changed;
  changed = diffKeys(prev.momentLiked, next.momentLiked, tsKey.liked, ts, now) || changed;
  changed = diffKeys(prev.mutedChannels, next.mutedChannels, tsKey.muted, ts, now) || changed;
  changed = diffKeys(prev.plans, next.plans, tsKey.plan, ts, now) || changed;
  changed = diffKeys(prev.digestTaps, next.digestTaps, tsKey.digest, ts, now) || changed;
  if (prev.settings !== next.settings) {
    for (const k of SYNC_SETTINGS) {
      const a = prev.settings[k];
      const b = next.settings[k];
      if ((a === undefined) !== (b === undefined) || (a !== b && canon(a) !== canon(b))) {
        ts[tsKey.setting(k)] = now;
        changed = true;
      }
    }
  }
  return changed ? { ...next, syncTs: ts } : next;
}

/** Hat sich in diesem Schritt etwas geändert, das zwischen Geräten wandert? Verweise genügen, weil alle Änderungen neue Objekte erzeugen. */
export function syncedChanged(a: AppState, b: AppState): boolean {
  return (
    a.momentSeen !== b.momentSeen ||
    a.momentLog !== b.momentLog ||
    a.dayCount !== b.dayCount ||
    a.savedMoments !== b.savedMoments ||
    a.momentWeights !== b.momentWeights ||
    a.recall !== b.recall ||
    a.feedbackNotes !== b.feedbackNotes ||
    a.notesPromptDay !== b.notesPromptDay ||
    a.momentDay !== b.momentDay ||
    a.momentLiked !== b.momentLiked ||
    a.mutedChannels !== b.mutedChannels ||
    a.feedTime !== b.feedTime ||
    a.weekReviewShown !== b.weekReviewShown ||
    a.plans !== b.plans ||
    a.digestTaps !== b.digestTaps ||
    SYNC_SETTINGS.some((k) => a.settings[k] !== b.settings[k])
  );
}
