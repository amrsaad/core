/**
 * Abrufkarte auf jede Bildschirmhöhe (Runde 28, ersetzt die Stufen 0 bis 6 aus Runde 23 und 24). Reine Regeln ohne DOM, damit sie in Vitest laufen.
 * RecallCard misst am Container und ruft sie auf. Die Karte hat keinen Kasten: ein Block auf der Seite unter der Reiterleiste.
 *
 * Stufen (data-fit an der Abrufseite):
 *   0  Frage 22/28, Antworten 16/22 mit Innenabstand 14
 *   1  Frage 20/26, Antworten 15/20 mit Innenabstand 12
 *   2  Frage 18/23, Antworten 14/19 mit Innenabstand 10, Abstände je 4 px kleiner
 *   3  zusätzlich Quelle aus, Tastenabstand 8
 * Gewählt wird die kleinste Stufe, bei der der Block vor UND nach der Antwort passt. Es wird nie gescrollt.
 */
export const FIT_MAX = 3;
/** Zahl der Stufen (0 bis FIT_MAX) */
export const FIT_LEVELS = FIT_MAX + 1;
/** Mindestabstand des Blocks zur Oberkante der Fläche beim ersten Anzeigen (px) */
export const RECALL_TOP_MIN = 16;
/** Nach der Antwort darf der Block bis auf diesen Abstand nach oben rücken (px) */
export const RECALL_TOP_MIN_DONE = 8;
/** Anteil des freien Platzes, der über dem Block liegt (der Rest darunter) */
export const RECALL_TOP_SHARE = 0.4;

/**
 * Kleinste Stufe ab from, bei der der Block vor der Antwort (ask[i], mit 16 px Abstand oben) und nach ihr (done[i], mit 8 px Abstand oben) in die Fläche passt.
 * room darf je Stufe eine andere Höhe haben. Passt keine, die letzte. Nach der Antwort wird mit from = Stufe vor der Antwort gewählt.
 */
export function pickRecallFit(ask: number[], done: number[], room: number | number[], from = 0): number {
  const last = Math.max(ask.length, done.length) - 1;
  if (last < 0) return 0;
  const roomOf = (i: number) => (typeof room === 'number' ? room : room[i] ?? room[room.length - 1] ?? 0);
  for (let i = Math.max(0, Math.min(from, last)); i <= last; i++) {
    if (Math.max((ask[i] ?? 0) + RECALL_TOP_MIN, (done[i] ?? 0) + RECALL_TOP_MIN_DONE) <= roomOf(i) + 0.5) return i;
  }
  return last;
}

/** Abstand von der Oberkante der Fläche bis zum Block beim ersten Anzeigen: 40 Prozent des freien Platzes, mindestens 16 px, nie mehr als der freie Platz. Ganze Pixel. */
export function recallTop(room: number, askH: number): number {
  const free = Math.max(0, room - askH);
  return Math.round(Math.min(free, Math.max(RECALL_TOP_MIN, RECALL_TOP_SHARE * free)));
}

/** Oberkante nach der Antwort: bleibt stehen, rückt nur so weit nach oben, wie der längere Block es braucht (nie über die Fläche hinaus) */
export function recallTopDone(top: number, room: number, doneH: number): number {
  return Math.max(0, Math.min(top, Math.floor(room - doneH)));
}

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
