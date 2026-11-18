/**
 * Abrufkarte auf jede Bildschirmhöhe (Runde 23). Reine Regeln ohne DOM, damit sie in Vitest laufen. RecallCard misst am Container und ruft sie auf.
 *
 * Stufen (data-fit an der Abrufseite, im Video- und Audio-Reiter an der Karte). Jede Stufe enthält die davor:
 *   0  normal
 *   1  Abstände kleiner, Tippflächen auf 44 px
 *   2  Hook auf eine Zeile (Auslassung am Wortende)
 *   3  Frage und Optionen eine Schriftstufe kleiner (Frage 19/24, Optionen 15/20, nie unter 15 px)
 *   4  Quelle (und Bereichszeile) ausblenden
 *   5  Text-Reiter: "Show text" ausblenden, die Karte ohne Rand und Innenabstand, Frage 17/22. Video und Audio: die Karte reicht bis unter die Kopfzeile
 *      und deckt das Bild ab, Frage 17/22.
 *   6  nur nach der Antwort: Kennzeichnung und Hook ausblenden, Erklärung und "Next" behalten den Platz
 * Passt auch die letzte Stufe nicht, scrollt nur die Erklärung (nach der Antwort) oder die Frage in sich, die Optionen und "Next" bleiben stehen.
 */
export const FIT_ASK_MAX = 5;
export const FIT_DONE_MAX = 6;
/** Zahl der Stufen, die vor der Antwort gemessen werden (0 bis FIT_ASK_MAX) beziehungsweise nach ihr (0 bis FIT_DONE_MAX) */
export const fitLevels = (answered: boolean): number => (answered ? FIT_DONE_MAX : FIT_ASK_MAX) + 1;

/** Kleinste Stufe ab from, bei der der Inhalt in die Fläche passt. needed[i] und room[i] gelten für Stufe i (room darf auch eine einzelne Zahl sein). Passt keine, die letzte. */
export function pickRecallFit(needed: number[], room: number | number[], from = 0): number {
  const last = needed.length - 1;
  if (last < 0) return 0;
  const roomOf = (i: number) => (typeof room === 'number' ? room : room[i] ?? room[room.length - 1] ?? 0);
  for (let i = Math.max(0, Math.min(from, last)); i <= last; i++) if (needed[i] <= roomOf(i) + 0.5) return i;
  return last;
}

/** Wie viele Pixel auf der gewählten Stufe überstehen (0, wenn es passt) */
export const fitOverflow = (needed: number[], room: number | number[], level: number): number => {
  const r = typeof room === 'number' ? room : room[level] ?? room[room.length - 1] ?? 0;
  return Math.max(0, (needed[level] ?? 0) - r);
};

/** Wisch nach oben ab dieser Strecke (px) */
export const RECALL_SWIPE_PX = 80;

export type SwipeVerdict = 'close' | 'blocked' | 'none';

/**
 * Was ein Wisch auf der Karte bewirkt. Unbeantwortet wechselt die Karte nie durch eine Geste (blocked), weiter geht es über "Skip" oder nach der Antwort.
 * Nach der Antwort schließt ein Wisch nach oben wie bei jedem Moment. Kürzer als RECALL_SWIPE_PX oder nach unten: nichts.
 */
export function recallSwipe(answered: boolean, dy: number): SwipeVerdict {
  if (!(dy < -RECALL_SWIPE_PX)) return 'none';
  return answered ? 'close' : 'blocked';
}

const TAIL = /[\s,;:.!?\u2013\u2014\u00b7(\[{"'-]+$/;

/**
 * Hook auf eine feste Zeilenzahl kürzen, nur an Wortgrenzen, mit "…" am Ende. fits(text) sagt, ob der Text in die Zeilen passt.
 * Passt der ganze Text, bleibt er unverändert. Satzzeichen vor der Auslassung entfallen. Ein einzelnes Wort, das allein nicht passt, bleibt mit "…" stehen.
 */
export function ellipsizeWords(full: string, fits: (text: string) => boolean): string {
  if (fits(full)) return full;
  const words = full.trim().split(/\s+/).filter(Boolean);
  const cut = (k: number) => `${words.slice(0, k).join(' ').replace(TAIL, '')}…`;
  let lo = 1;
  let hi = words.length - 1;
  let best = 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fits(cut(mid))) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return cut(best);
}
