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

/** Nur für Tests */
export function resetFirstPlay(): void {
  played = false;
  waiters.clear();
}
