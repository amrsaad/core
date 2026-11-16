// Runde 12: Der erste Sync-Upload nach dem Öffnen wartet, bis der erste Audio- oder Video-Moment spielt (Max' Diag 13.11.: 1,4 MB Upload in denselben
// Sekunden wie der erste Audio-Start, bei langsamem Netz nimmt er dem Start die Bandbreite). Der Feed meldet das erste PLAYING hier, der Sync wartet darauf.

let played = false;
const waiters = new Set<() => void>();

/** Der Feed meldet: ein Moment spielt (erstes PLAYING des aktuellen Moments, Audio oder Video). Wirkt nur beim ersten Mal. */
export function markFirstPlay(): void {
  if (played) return;
  played = true;
  for (const w of [...waiters]) w();
  waiters.clear();
}

/** Läuft schon ein Moment? */
export const hasFirstPlayed = (): boolean => played;

/** Versprechen, das sich beim ersten PLAYING löst (sofort, wenn es schon war) */
export function waitFirstPlay(): Promise<void> {
  if (played) return Promise.resolve();
  return new Promise((res) => waiters.add(res));
}

/** Runde 18: ein Audio- oder Video-Moment lädt und spielt noch nicht (der Feed meldet es aus seiner Abfrage). Der Sync startet dann keinen Upload. */
let feedLoading = false;
export function setFeedLoading(on: boolean): void {
  feedLoading = on;
}
export const isFeedLoading = (): boolean => feedLoading;

/** Runde 18b: schwaches Netz (Merker im Audio-Deck oder für Video im Feed). Nur dann drosselt der Sync seine Uploads. */
let weakNet = false;
export function setWeakNet(on: boolean): void {
  weakNet = on;
}
export const isWeakNet = (): boolean => weakNet;

/** Nur für Tests */
export function resetFirstPlay(): void {
  played = false;
  feedLoading = false;
  weakNet = false;
  waiters.clear();
}
