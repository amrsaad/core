/**
 * Abrufkarte (Bauliste Runde 1, Punkt 5, Fundament R7, R8, R9, R10, R22), neu am 27.10.2026 (Max):
 * Multiple Choice aus dem Feld recall des Moments. Fest nach jedem 4. Moment, Kandidat aus den letzten 4 mit mindestens
 * 80 % geschaut und mit Feld recall. Moment ohne recall bekommt nie eine Karte.
 * Wiedervorlage: Fehler nach 2 Tagen, Treffer nach 7 Tagen, zweiter Treffer in Folge nach 21 Tagen, dritter beendet.
 * Wischen überspringt ohne Wertung. Keine Punkte, keine Streaks.
 * Reine Funktionen, gleiche Regeln für ios/Core.
 */
export const RECALL_EVERY = 4;
export const MIN_WATCHED = 0.8;
export const DAY_MS = 86_400_000;
export const MISS_GAP_DAYS = 2;
export const HIT_GAP_DAYS = 7;
export const SECOND_HIT_GAP_DAYS = 21;
/** Core Digest (Know oder Rule, recallBoost): kürzere Abstände 1, 4 und 14 Tage statt 2, 7 und 21 */
export const BOOST_MISS_GAP_DAYS = 1;
export const BOOST_HIT_GAP_DAYS = 4;
export const BOOST_SECOND_HIT_GAP_DAYS = 14;

export interface RecallResult {
  at: number;
  got: boolean;
}

export interface RecallItem {
  id: string;
  /** nächste Fälligkeit in ms, null = abgeschlossen */
  due: number | null;
  results: RecallResult[];
}

export type RecallState = Record<string, RecallItem>;

export interface Recent {
  id: string;
  /** geschauter Anteil 0 bis 1 */
  watched: number;
}

/** Nach jedem 4. gesehenen Moment kommt eine Karte */
export const cardDue = (seenInSession: number) => seenInSession > 0 && seenInSession % RECALL_EVERY === 0;

/**
 * Welcher Moment wird abgefragt. Zuerst eine fällige Wiedervorlage, sonst der zuletzt gesehene
 * der letzten 4 mit mindestens 80 % geschaut, der noch nie abgefragt wurde. null = keine Karte.
 */
export function pickRecall(recall: RecallState, recent: Recent[], now: number, available: (id: string) => boolean): { id: string; review: boolean } | null {
  const due = Object.values(recall)
    .filter((x) => x.due !== null && x.due <= now && available(x.id))
    .sort((a, b) => (a.due ?? 0) - (b.due ?? 0))[0];
  if (due) return { id: due.id, review: true };
  const fresh = recent
    .slice(-RECALL_EVERY)
    .reverse()
    .find((r) => r.watched >= MIN_WATCHED && !recall[r.id] && available(r.id));
  return fresh ? { id: fresh.id, review: false } : null;
}

/** Treffer in Folge am Ende der Ergebnisse */
const trailingHits = (results: RecallResult[]) => {
  let n = 0;
  for (let i = results.length - 1; i >= 0 && results[i].got; i--) n++;
  return n;
};

/** Ergebnis eintragen und nächste Fälligkeit setzen. boost: Moment mit recallBoost, kürzere Abstände. */
export function answer(recall: RecallState, id: string, got: boolean, now: number, boost = false): RecallState {
  const prev = recall[id] ?? { id, due: null, results: [] };
  const results = [...prev.results, { at: now, got }];
  const hits = trailingHits(results);
  let due: number | null;
  const gaps = boost ? [BOOST_MISS_GAP_DAYS, BOOST_HIT_GAP_DAYS, BOOST_SECOND_HIT_GAP_DAYS] : [MISS_GAP_DAYS, HIT_GAP_DAYS, SECOND_HIT_GAP_DAYS];
  if (!got) due = now + gaps[0] * DAY_MS;
  else if (hits === 1) due = now + gaps[1] * DAY_MS;
  else if (hits === 2) due = now + gaps[2] * DAY_MS;
  else due = null;
  return { ...recall, [id]: { id, due, results } };
}

/** Reihenfolge der drei Antworten: Indizes in options, zufällig gemischt (Fisher-Yates) */
export function shuffleOrder(n: number, rng: () => number = Math.random): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** "gekonnt" nur nach einer richtigen Wahl (R22) */
export const isKnown = (recall: RecallState, id: string) => !!recall[id]?.results.some((r) => r.got);
