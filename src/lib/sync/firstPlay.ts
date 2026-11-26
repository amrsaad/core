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

/**
 * Runde 46 (Schalter SYNC_AFTER_STABLE, Gerätelog 26.11.: der erste Upload, rund 270 kB, startete 0,1 s nach dem ersten Ton und löste Stalls nach 4,2 und 8,5 s aus):
 * der erste Upload nach dem App-Start wartet nicht mehr auf das erste PLAYING, sondern bis Audio oder Video SYNC_STABLE_MS am Stück ohne Stall gespielt hat (oder die App verlassen wird,
 * oder nach spätestens SYNC_FIRST_MAX_MS). Weitere Uploads starten nicht, solange der aktive Moment kürzer als SYNC_PLAY_MIN_MS spielt oder gerade stockt. Der Abruf (GET) wartet nie.
 * false: Verhalten von Runde 45 (erster Upload beim ersten PLAYING, sonst keine Wartezeit).
 */
export const SYNC_AFTER_STABLE = true;
export const SYNC_STABLE_MS = 20_000;
export const SYNC_FIRST_MAX_MS = 120_000;
export const SYNC_PLAY_MIN_MS = 5_000;
/** So lange wartet ein Upload bei stockendem Moment bis zur nächsten Prüfung (ms) */
export const SYNC_STALL_RECHECK_MS = 1_000;

export type PlayPhase = 'playing' | 'stalled' | 'idle';

/** Wie lange muss ein Upload jetzt noch warten (ms, 0: darf)? Spielt der aktive Moment: bis er SYNC_PLAY_MIN_MS am Stück spielt. Stockt er: nächste Prüfung. Sonst (Pause, nichts läuft): sofort. */
export function playGate(o: { phase: PlayPhase; sinceMs: number; minMs?: number }): number {
  if (o.phase === 'stalled') return SYNC_STALL_RECHECK_MS;
  if (o.phase === 'playing') return Math.max(0, (o.minMs ?? SYNC_PLAY_MIN_MS) - Math.max(0, o.sinceMs));
  return 0;
}

let phase: PlayPhase = 'idle';
let phaseAt = 0;
let stableDone = false;
let stableTimer: ReturnType<typeof setTimeout> | undefined;
const stableWaiters = new Set<() => void>();

const openStable = () => {
  stableDone = true;
  for (const w of [...stableWaiters]) w();
  stableWaiters.clear();
};

/**
 * Der Feed meldet den Zustand des aktuellen Moments (Audio oder Video): playing, stalled (Puffern) oder idle (Pause, Laden, Ende, nichts). Jeder Wechsel setzt die Zeit "am Stück" zurück.
 * Nach SYNC_STABLE_MS am Stück playing ist der erste Upload frei (waitStablePlay).
 */
export function setPlayPhase(p: PlayPhase, nowMs: number = Date.now()): void {
  if (p === phase) return;
  phase = p;
  phaseAt = nowMs;
  clearTimeout(stableTimer);
  stableTimer = undefined;
  if (p === 'playing' && !stableDone) stableTimer = setTimeout(openStable, SYNC_STABLE_MS);
}

/** Wartezeit eines weiteren Uploads wegen des aktiven Moments (ms), siehe playGate */
export const playGateNow = (nowMs: number = Date.now()): number => playGate({ phase, sinceMs: nowMs - phaseAt });

/** Hat Audio oder Video schon SYNC_STABLE_MS am Stück gespielt? */
export const hasStablePlayed = (): boolean => stableDone;

/** Versprechen, das sich nach SYNC_STABLE_MS am Stück spielen löst (sofort, wenn es schon war) */
export function waitStablePlay(): Promise<void> {
  if (stableDone) return Promise.resolve();
  return new Promise((res) => stableWaiters.add(res));
}

/** Nur für Tests */
export function resetFirstPlay(): void {
  played = false;
  feedLoading = false;
  weakNet = false;
  waiters.clear();
  phase = 'idle';
  phaseAt = 0;
  stableDone = false;
  clearTimeout(stableTimer);
  stableTimer = undefined;
  stableWaiters.clear();
}
