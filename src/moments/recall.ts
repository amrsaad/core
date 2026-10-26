/**
 * Abrufkarte (Bauliste Runde 1, Punkt 5, Fundament R7, R8, R9, R10, R22).
 * Freigabe Max 26.10.2026: fest nach jedem 4. Moment, Kandidat aus den letzten 4 mit mindestens 80 % geschaut,
 * Wiedervorlage als Karte nach 7 Tagen, gespeicherte Momente nach "Got it" zusätzlich nach 21 Tagen,
 * Wischen überspringt ohne Wertung. Keine Punkte, keine Streaks.
 * Reine Funktionen, gleiche Regeln für ios/Core.
 */
export const RECALL_EVERY = 4;
export const MIN_WATCHED = 0.8;
export const DAY_MS = 86_400_000;
export const FIRST_GAP_DAYS = 7;
export const SAVED_GAP_DAYS = 21;

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

/** Ergebnis eintragen und nächste Fälligkeit setzen */
export function answer(recall: RecallState, id: string, got: boolean, now: number, saved: boolean): RecallState {
  const prev = recall[id] ?? { id, due: null, results: [] };
  const results = [...prev.results, { at: now, got }];
  let due: number | null;
  if (!got) due = now + FIRST_GAP_DAYS * DAY_MS;
  else {
    // Erste Karte: 7-Tage-Wiedervorlage. Erstes "Got it" in einer Wiedervorlage: bei gespeicherten Momenten noch die 21-Tage-Karte, sonst fertig
    const reviewGots = results.slice(1).filter((r) => r.got).length;
    if (prev.results.length === 0) due = now + FIRST_GAP_DAYS * DAY_MS;
    else if (saved && reviewGots === 1) due = now + SAVED_GAP_DAYS * DAY_MS;
    else due = null;
  }
  return { ...recall, [id]: { id, due, results } };
}

/** "gekonnt" nur nach "Got it" (R22) */
export const isKnown = (recall: RecallState, id: string) => !!recall[id]?.results.some((r) => r.got);
