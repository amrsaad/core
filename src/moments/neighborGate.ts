// Runde 15: Vorrang für den aktiven Stream-Moment. Reine Funktionen ohne Browser, damit die Reihenfolge testbar ist.
// Nachbarn (idx+1, idx+2) laden erst, wenn der aktive Moment stabil spielt, einer nach dem anderen. Stockt der aktive Moment, wird das
// laufende Vorladen angehalten. Hängt der aktive Moment schon am Start, darf der nächste Nachbar nach DEADLINE_MS trotzdem laden.

/** Spielt seit so langer Zeit ohne waiting: stabil (ms) */
export const STABLE_PLAYING_MS = 2000;
/** readyState 4 mit so viel Puffer vor der Abspielposition: stabil (Sekunden) */
export const STABLE_AHEAD_S = 8;
/** Waiting länger als das gilt als Stockung (ms) */
export const STALL_MS = 300;
/** Ohne stabilen Start nach dieser Zeit darf der nächste Nachbar trotzdem laden (ms). Gilt auch für den übernächsten nach dem nächsten. */
export const DEADLINE_MS = 6000;
/** Erholung: waiting länger als das, obwohl der Moment schon gespielt hat (ms) */
export const RECOVER_AFTER_MS = 3000;
/** Höchstens so viele Erholungsversuche je Moment */
export const RECOVER_MAX = 2;

/** Was der Feed vom aktiven Moment sieht */
export interface ActiveObs {
  /** Der aktive Moment hat in dieser Sitzung schon PLAYING erreicht */
  playedBefore: boolean;
  /** Element spielt (nicht paused, Ereignis playing kam) */
  playing: boolean;
  /** Zeit seit dem letzten playing ohne waiting dazwischen (ms), 0 wenn nicht spielend */
  playingMs: number;
  /** Zeit seit dem letzten waiting ohne playing danach (ms), 0 wenn nicht wartend */
  waitingMs: number;
  /** readyState des aktiven Elements */
  rs: number;
  /** Sekunden Puffer vor der Abspielposition (aus buffered) */
  ahead: number;
  /** Der Nutzer hat angehalten: keine Konkurrenz um die Leitung, Nachbarn dürfen laden */
  userPaused: boolean;
  /** Zeit seit dem Wechsel auf diesen Moment (ms) */
  sinceMs: number;
}

/** Stabil: spielt seit mindestens 2 s ohne waiting, oder readyState 4 mit mindestens 8 s Puffer */
export function isStable(a: Pick<ActiveObs, 'playing' | 'playingMs' | 'waitingMs' | 'rs' | 'ahead'>): boolean {
  if (a.playing && a.waitingMs === 0 && a.playingMs >= STABLE_PLAYING_MS) return true;
  return a.rs >= 4 && a.ahead >= STABLE_AHEAD_S;
}

/** Stockung: der Moment hat schon gespielt und wartet länger als 300 ms. Vor dem ersten Bild gilt die Frist, nicht die Stockung. */
export function isStalled(a: Pick<ActiveObs, 'playedBefore' | 'waitingMs'>): boolean {
  return a.playedBefore && a.waitingMs > STALL_MS;
}

export interface NeighborObs {
  /** 1 = der nächste, 2 = der übernächste */
  rank: 1 | 2;
  /** Der Nachbar lädt gerade (Vorladen freigegeben und gestartet) */
  started: boolean;
  /** Der Nachbar hat canplay gemeldet (oder braucht nichts, z.B. Text) */
  canplay: boolean;
  /** Nur rank 2: der nächste Nachbar hat canplay gemeldet (oder braucht nichts) */
  prevCanplay: boolean;
  /** Nur rank 2: so lange lädt der nächste Nachbar schon (ms), 0 wenn er nicht lädt */
  prevStartedMs: number;
}

export type NeighborCall =
  /** Laden freigeben (why sagt, warum) */
  | { call: 'start'; why: 'stable' | 'paused' | 'deadline' }
  /** Noch warten */
  | { call: 'defer' }
  /** Laufendes Vorladen anhalten (Quelle freigeben) */
  | { call: 'pause' }
  /** Nichts tun: lädt schon oder ist fertig */
  | { call: 'keep' };

/**
 * Wann darf welcher Nachbar laden.
 * 1. Fertig (canplay): bleibt.
 * 2. Aktiver Moment stockt: ladende Nachbarn werden angehalten, wartende bleiben wartend (keine Frist, solange er stockt).
 * 3. Der übernächste wartet auf canplay des nächsten, oder DEADLINE_MS, nachdem der nächste zu laden begann.
 * 4. Aktiver Moment stabil oder vom Nutzer angehalten: Laden frei.
 * 5. Aktiver Moment hat noch nie gespielt und DEADLINE_MS sind seit dem Wechsel vergangen: der nächste darf laden (sonst lädt bei hängendem
 *    aktivem Moment nie etwas vor, z.B. bei slow 3g).
 */
export function neighborCall(a: ActiveObs, n: NeighborObs): NeighborCall {
  if (n.canplay) return { call: 'keep' };
  if (isStalled(a)) return n.started ? { call: 'pause' } : { call: 'defer' };
  if (n.rank === 2 && !n.prevCanplay && n.prevStartedMs < DEADLINE_MS) return n.started ? { call: 'keep' } : { call: 'defer' };
  if (n.started) return { call: 'keep' };
  if (a.userPaused) return { call: 'start', why: 'paused' };
  if (isStable(a)) return { call: 'start', why: 'stable' };
  if (!a.playedBefore && a.sinceMs >= DEADLINE_MS) return { call: 'start', why: 'deadline' };
  return { call: 'defer' };
}

/** Sekunden Puffer vor t aus Bereichen [start, end] (aus TimeRanges), 0 wenn t in keinem Bereich liegt */
export function aheadOf(ranges: readonly (readonly [number, number])[], t: number): number {
  for (const [s, e] of ranges) if (t >= s - 0.1 && t <= e) return Math.max(0, e - t);
  return 0;
}

export type RecoverCall = { call: 'none' } | { call: 'play' } | { call: 'nudge' };

/**
 * Erholung beim aktiven Stream-Moment: länger als 3 s in waiting, obwohl er schon gespielt hat, höchstens zweimal je Moment, die Versuche
 * mindestens RECOVER_AFTER_MS auseinander. Pausiert das Element (und wollte der Feed spielen): play() erneut. Sonst die Position um 0,1 s vorsetzen.
 */
export function recoverCall(s: { playedBefore: boolean; waitingMs: number; paused: boolean; done: number; sinceLastMs: number; userPaused: boolean }): RecoverCall {
  if (s.userPaused || !s.playedBefore || s.done >= RECOVER_MAX) return { call: 'none' };
  if (s.waitingMs <= RECOVER_AFTER_MS) return { call: 'none' };
  if (s.done > 0 && s.sinceLastMs < RECOVER_AFTER_MS) return { call: 'none' };
  return s.paused ? { call: 'play' } : { call: 'nudge' };
}

/**
 * Ein Nachbar, der schon geladen ist, wird nicht erneut geladen oder neu positioniert, solange sein Moment gleich bleibt:
 * gleiche Quelle auf dem gleichen Element, gleicher Ausschnitt, kein Abspielwunsch, Metadaten schon da.
 */
export function skipsReload(prev: { id: string; start: number; end: number | undefined } | null, next: { id: string; start: number; end: number | undefined }, o: { sameEl: boolean; sameSrc: boolean; play: boolean; wantPlay: boolean; rs: number }): boolean {
  return !!prev && prev.id === next.id && prev.start === next.start && prev.end === next.end && o.sameEl && o.sameSrc && !o.play && !o.wantPlay && o.rs >= 1;
}
