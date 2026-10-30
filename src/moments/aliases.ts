/**
 * Alias-Auflösung für Moment-IDs (Issue 7, Auftrag Max 30.10.2026).
 * Ändert sich der Start eines Moments (Neueinordnung im Audio), ändert sich seine ID (videoId:start). Der Pool gibt dem Moment dann
 * `aliases: [alteId]` mit (build-enc, dauerhaft). Hier wird daraus eine Map alteId zu aktueller ID gebaut und der gespeicherte Stand
 * (Saves, Gesehen, Protokoll, Herzen, Notizen, Abrufplan, Zeitstempel des Syncs) beim Lesen darüber umgestellt.
 *
 * Eigenschaften:
 * - Idempotent: ein schon umgestellter Stand bleibt gleich (gleicher Verweis).
 * - Zeitstempel des Syncs wandern mit: saved:<alt> und liked:<alt> werden zu saved:<neu> und liked:<neu> (das größere der beiden).
 *   Die Umstellung ist also keine neue Änderung und überschreibt nichts, was ein anderes Gerät später getan hat.
 * - Der Sync stellt auch das fremde Dokument vor dem Zusammenführen um (controller.ts). So bringt ein Gerät mit altem Stand die alten IDs nicht zurück.
 * - Alias, der selbst eine aktuelle ID im Pool ist, zählt nicht (aktuelle IDs gewinnen).
 * - Bleibt ein Eintrag ohne Moment im Pool (entfernt), bleibt er unverändert.
 * Reine Funktionen.
 */
import type { AppState, SavedMoment } from '../lib/state';
import { applyDoc, canon, combineSaved, mergeLog, mergeNotes, mergeRecallItem, toDoc, type SyncDoc } from '../lib/sync/merge';
import type { RecallState } from './recall';
import type { Moment } from './types';

export interface AliasIndex {
  /** alte ID zu aktueller ID */
  map: Record<string, string>;
  /** aktuelle ID zu Moment, für frische Abbilder gemerkter Momente */
  byId: Map<string, Moment>;
}

export const NO_ALIASES: AliasIndex = { map: {}, byId: new Map() };

export function buildAliasIndex(moments: Moment[]): AliasIndex {
  const byId = new Map(moments.map((m) => [m.id, m]));
  const map: Record<string, string> = {};
  for (const m of moments) {
    for (const a of m.aliases ?? []) if (typeof a === 'string' && a !== m.id && !byId.has(a) && !(a in map)) map[a] = m.id;
  }
  return { map, byId };
}

const res = (idx: AliasIndex, id: string) => idx.map[id] ?? id;
const has = (idx: AliasIndex, id: string) => id in idx.map;

/** Zeitstempel-Schlüssel mit Moment-ID: saved:<id> und liked:<id> */
const TS_PREFIXES = ['saved:', 'liked:'] as const;

function renameKeys<T>(o: Record<string, T>, idx: AliasIndex, combine: (a: T, b: T) => T): Record<string, T> {
  const out: Record<string, T> = {};
  // aktuelle Schlüssel zuerst, damit die Reihenfolge der Zusammenführung nichts ändert
  for (const k of Object.keys(o).sort((p, q) => Number(has(idx, p)) - Number(has(idx, q)) || (p < q ? -1 : p > q ? 1 : 0))) {
    const nk = res(idx, k);
    out[nk] = nk in out ? combine(out[nk], o[k]) : o[k];
  }
  return out;
}

/**
 * Schlüssel mit Zeitstempel (gemerkt, Herz) auf aktuelle IDs umstellen, nach denselben Regeln wie der Sync (merge.ts lww):
 * je aktueller ID gelten alte und neue Schlüssel wie ein Eintrag. Der jüngste Zeitstempel gewinnt, auch wenn er ein Entfernen ist
 * (Schlüssel fehlt, Zeitstempel da). Bei gleichem Stand gewinnt "vorhanden". Mehrere vorhandene mit gleichem Zeitstempel: zusammengeführt.
 * So bringt ein altes Gerät weder einen entfernten Eintrag zurück noch löscht es einen neuen, den es nie sah.
 */
function resolveLww<T>(prefix: string, obj: Record<string, T>, ts: Record<string, number>, idx: AliasIndex, combine: (a: T, b: T) => T): { obj: Record<string, T>; ts: Record<string, number> } {
  const groups = new Map<string, string[]>();
  const add = (k: string) => {
    const c = res(idx, k);
    const g = groups.get(c) ?? [];
    if (!g.includes(k)) g.push(k);
    groups.set(c, g);
  };
  for (const k of Object.keys(obj)) add(k);
  for (const k of Object.keys(ts)) if (k.startsWith(prefix)) add(k.slice(prefix.length));
  const outObj: Record<string, T> = {};
  const outTs: Record<string, number> = {};
  for (const [c, members] of groups) {
    const keys = members.sort();
    const present = keys.filter((k) => k in obj).map((k) => ({ k, t: ts[prefix + k] ?? 0 }));
    const absentTs = keys.filter((k) => !(k in obj)).reduce((mx, k) => Math.max(mx, ts[prefix + k] ?? -1), -1);
    const bestTs = present.reduce((mx, p) => Math.max(mx, p.t), -1);
    if (present.length && bestTs >= absentTs) {
      const winners = present.filter((p) => p.t === bestTs).map((p) => obj[p.k]);
      outObj[c] = winners.reduce((a, b) => combine(a, b));
      if (bestTs > 0) outTs[prefix + c] = bestTs;
    } else if (absentTs >= 0) {
      if (absentTs > 0) outTs[prefix + c] = absentTs;
    }
  }
  return { obj: outObj, ts: outTs };
}

/** Hat das Dokument irgendwo eine alte ID? Schneller Vorabtest, damit unveränderte Stände ohne Aufwand durchgehen. */
function touches(d: SyncDoc, idx: AliasIndex): boolean {
  const s = d.state;
  if (!Object.keys(idx.map).length) return false;
  return (
    Object.keys(s.momentSeen).some((k) => has(idx, k)) ||
    Object.keys(s.savedMoments).some((k) => has(idx, k)) ||
    Object.keys(s.momentLiked).some((k) => has(idx, k)) ||
    Object.keys(s.recall).some((k) => has(idx, k) || has(idx, s.recall[k].id)) ||
    s.momentLog.some((e) => has(idx, e.id)) ||
    s.feedbackNotes.some((n) => has(idx, n.id)) ||
    Object.keys(d.ts).some((k) => TS_PREFIXES.some((p) => k.startsWith(p) && has(idx, k.slice(p.length))))
  );
}

/** Dokument mit aktuellen IDs. Ohne alte ID kommt dasselbe Objekt zurück. */
export function migrateDoc(d: SyncDoc, idx: AliasIndex): SyncDoc {
  if (!touches(d, idx)) return d;
  const s = d.state;
  const sv = resolveLww<SavedMoment>('saved:', s.savedMoments, d.ts, idx, combineSaved);
  const lk = resolveLww<number>('liked:', s.momentLiked, d.ts, idx, Math.max);
  const saved = sv.obj;
  // Gemerkte Momente zeigen das Abbild aus dem Pool (Start, Ende und Untertitel der aktuellen Fassung)
  for (const [k, v] of Object.entries(saved)) {
    if (v.moment.id === k) continue;
    const cur = idx.byId.get(k);
    saved[k] = { ...v, moment: cur ?? { ...v.moment, id: k } };
  }
  const recall: RecallState = {};
  for (const k of Object.keys(s.recall).sort((p, q) => Number(has(idx, p)) - Number(has(idx, q)) || (p < q ? -1 : 1))) {
    const nk = res(idx, k);
    const item = { ...s.recall[k], id: res(idx, s.recall[k].id) };
    recall[nk] = nk in recall ? mergeRecallItem(recall[nk], item) : item;
  }
  const notes = mergeNotes(
    s.feedbackNotes.map((n) => {
      if (!has(idx, n.id)) return n;
      const id = res(idx, n.id);
      return { ...n, id, key: n.key.startsWith(`${n.id}#`) ? `${id}#${n.key.slice(n.id.length + 1)}` : n.key };
    }),
    [],
  );
  // Alle Zeitstempel außer saved:/liked: bleiben; diese zwei Familien kommen aus resolveLww
  const ts: Record<string, number> = {};
  for (const [k, v] of Object.entries(d.ts)) if (!TS_PREFIXES.some((p) => k.startsWith(p))) ts[k] = v;
  Object.assign(ts, sv.ts, lk.ts);
  return {
    ...d,
    state: {
      ...s,
      momentSeen: renameKeys(s.momentSeen, idx, Math.min),
      momentLog: mergeLog(
        s.momentLog.map((e) => (has(idx, e.id) ? { ...e, id: res(idx, e.id) } : e)),
        [],
      ),
      savedMoments: saved,
      momentLiked: lk.obj,
      recall,
      feedbackNotes: notes,
    },
    ts,
  };
}

/** App-Zustand mit aktuellen IDs. Ohne alte ID kommt derselbe Zustand zurück (gleicher Verweis). */
export function migrateState(s: AppState, idx: AliasIndex): AppState {
  if (!Object.keys(idx.map).length) return s;
  const cur = toDoc(s);
  const next = migrateDoc(cur, idx);
  return next === cur || canon(next) === canon(cur) ? s : applyDoc(s, next);
}
