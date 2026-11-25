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
  /** Runde 19: schwaches Netz (isWeakNet): nur der nächste Nachbar, erst nach WEAK_STABLE_MS stabilem Spiel, keine Frist. Fehlt: Netz gut. */
  weak?: boolean;
  /**
   * Runde 41 (Schalter VIDEO_SWITCH): Frist, nach der der nächste Nachbar bei einem aktiven Moment ohne erstes Bild laden darf (ms), auch im schwachen Netz.
   * Fehlt: DEADLINE_MS, im schwachen Netz keine Frist. Der Feed setzt SWITCH_MS, wenn VIDEO_SWITCH an ist.
   */
  deadlineMs?: number;
}

/**
 * Runde 41, Schalter: Video wartet nicht mehr auf einen Moment, der kein erstes Bild bekommt (Gerätediag 25.11.: vier Wechsel 4334, 3551, 314, 5224 ms, zwei YouTube-Momente
 * kamen nie zum Laufen, während kein Nachbar bereit war, weil "active not stable" das Vorladen sperrte). Aus: false, dann gilt das Verhalten von Runde 40.
 * Was er einschaltet: (1) der nächste Nachbar lädt nach SWITCH_MS vor, auch im schwachen Netz, (2) ein bereiter HLS-Nachbar ersetzt nach SWITCH_MS einen aktiven Moment
 * ohne erstes Bild (switchCall), (3) im schwachen Netz lädt ein HLS-Moment hinter einem YouTube-Nachbarn mit vor (hlsBehindYt).
 */
export const VIDEO_SWITCH = true;
/** Ohne erstes Bild nach so langer Zeit wechselt die App auf einen bereiten Nachbarn und lässt den Nachbarn vorladen (ms). Die Messgröße des Nutzers: kein Wechsel über 3 s. */
export const SWITCH_MS = 3000;
/** Schalter nur für (3): im schwachen Netz zählt ein HLS-Moment hinter einem YouTube-Moment als nächster Vorlade-Kandidat (YouTube lädt auf iOS nur per cue und startet im Weak-Netz unsicher) */
export const HLS_BEHIND_YT = true;

export type SwitchCall =
  /** Nichts tun */
  | { call: 'none' }
  /** Kein Nachbar bereit (Zeile in der Diag, einmal je Moment) */
  | { call: 'no-ready' }
  /** Auf den Moment idx + offset wechseln */
  | { call: 'go'; offset: 1 | 2 };

/**
 * Wann ein Moment ohne erstes Bild ersetzt wird. waitedMs: Zeit ohne Bild seit dem Wechsel auf ihn. playedBefore: er hat schon gespielt (dann nie ersetzen, eine Stockung
 * mitten im Spiel ist kein nie startender Moment). ready1, ready2: der nächste und der übernächste Moment haben ihr erstes Bild (HLS mit Daten). Der nächste hat Vorrang.
 * Ein Moment, den der Nutzer angehalten hat, bleibt stehen.
 */
export function switchCall(o: { enabled?: boolean; waitedMs: number; playedBefore: boolean; userPaused: boolean; ready1: boolean; ready2: boolean }): SwitchCall {
  if (!(o.enabled ?? VIDEO_SWITCH) || o.playedBefore || o.userPaused || o.waitedMs < SWITCH_MS) return { call: 'none' };
  if (o.ready1) return { call: 'go', offset: 1 };
  if (o.ready2) return { call: 'go', offset: 2 };
  return { call: 'no-ready' };
}

/** Runde 41 (3): im schwachen Netz ist ein HLS-Moment auf Rang 2 hinter einem YouTube-Moment auf Rang 1 der eigentliche nächste Kandidat und lädt wie ein Rang-1-Nachbar */
export function hlsBehindYt(o: { enabled?: boolean; weak: boolean; rank: 1 | 2; rank1IsYoutube: boolean; selfIsHls: boolean }): boolean {
  return (o.enabled ?? HLS_BEHIND_YT) && o.weak && o.rank === 2 && o.rank1IsYoutube && o.selfIsHls;
}

/** Runde 19: so lange gilt das Netz nach einem Anlass als schwach (ms) */
export const WEAK_VIDEO_MS = 5 * 60_000;
/** Runde 19: Wisch bis playing länger als das ist ein Anlass für "schwaches Netz" (ms) */
export const SLOW_START_MS = 3000;
/** Runde 19: im schwachen Netz lädt der nächste Nachbar erst, wenn der aktive so lange am Stück ohne waiting spielt (ms) */
export const WEAK_STABLE_MS = 3000;

/** Runde 19: Wisch bis playing (ms) war so langsam, dass das Netz als schwach gilt */
export function slowStart(ms: number): boolean {
  return ms > SLOW_START_MS;
}

/** Runde 19: Ende des Merkers, wenn jetzt ein Anlass vorliegt */
export function weakUntil(now: number): number {
  return now + WEAK_VIDEO_MS;
}

/** Runde 19: schwaches Netz: der eigene Merker läuft noch, oder der Merker des Audio-Decks ist gesetzt */
export function isWeakNet(o: { until: number; now: number; deckWeak: boolean }): boolean {
  return o.until > o.now || o.deckWeak;
}

/** Runde 19: so viele Nachbarn dürfen vorladen (schwaches Netz: einer, sonst zwei) */
export function neighborBudget(weak: boolean): 1 | 2 {
  return weak ? 1 : 2;
}

/** Runde 19: stabil im schwachen Netz: spielt WEAK_STABLE_MS am Stück ohne waiting (der Puffer-Kurzschluss aus isStable gilt hier nicht) */
export function isWeakStable(a: Pick<ActiveObs, 'playing' | 'playingMs' | 'waitingMs'>): boolean {
  return a.playing && a.waitingMs === 0 && a.playingMs >= WEAK_STABLE_MS;
}

// Runde 19: Startüberwachung eines YouTube-Moments nach dem Startbefehl in der Geste (iOS). Der erste Befehl verpufft oft (Zustand 3, dann -1),
// darum früh und gestaffelt nachstoßen, solange die Nutzeraktivierung von iOS noch gilt. Reine Funktion, der Feed führt sie aus.
/** Erster Wiederholungsversuch, wenn der Player so lange nach dem Befehl nicht in Zustand 1 oder 3 ist (ms) */
export const START_RETRY_FIRST_MS = 800;
/** Zweiter Versuch so lange nach dem ersten (ms) */
export const START_RETRY_NEXT_MS = 2000;
/** Höchstens so viele Wiederholungsversuche vor der Tippfläche */
export const START_RETRY_MAX = 2;
/**
 * Tippfläche so lange nach dem Startbefehl, wenn weder Spielen noch ein Versuch geholfen hat (ms). Bleibt bei 6 s: im Mobilfunk puffert der Player oft
 * 4 bis 5 s im Zustand 3, eine frühere Tippfläche wäre dort ein Fehlalarm. Die Gewinne liegen bei den Versuchen, nicht bei der Tippfläche.
 */
export const START_GIVEUP_MS = 6000;
/** Prüftakt, solange ein Versuch am Zustand 3 scheitert (ms) */
export const START_POLL_MS = 250;

export type StartCall =
  /** Noch nichts tun, in waitMs erneut prüfen */
  | { call: 'wait'; waitMs: number }
  /** playVideo erneut senden (try = laufende Nummer ab 1) */
  | { call: 'retry'; try: number }
  /** Tippfläche zeigen */
  | { call: 'tap' };

/**
 * Was die Startüberwachung jetzt tut. st = Zustand des Players, tries = bisherige Wiederholungen, sinceCmdMs = Zeit seit dem Startbefehl in der Geste,
 * sinceTryMs = Zeit seit dem letzten Wiederholungsversuch (egal bei tries 0). Zustand 3 (puffert) und 1 (spielt) bekommen nie einen Versuch (Regel aus Runde 17).
 * Versuche nur bei -1, 5 oder 2. Die Tippfläche kommt nach START_GIVEUP_MS, auch wenn der Player puffert (wie bisher).
 */
export function startWatchCall(o: { st: number; tries: number; sinceCmdMs: number; sinceTryMs: number }): StartCall {
  if (o.sinceCmdMs >= START_GIVEUP_MS) return { call: 'tap' };
  const giveIn = START_GIVEUP_MS - o.sinceCmdMs;
  if (o.tries >= START_RETRY_MAX) return { call: 'wait', waitMs: Math.max(1, giveIn) };
  const dueIn = o.tries === 0 ? START_RETRY_FIRST_MS - o.sinceCmdMs : START_RETRY_NEXT_MS - o.sinceTryMs;
  if (dueIn > 0) return { call: 'wait', waitMs: Math.min(dueIn, giveIn) };
  const retryable = o.st === -1 || o.st === 5 || o.st === 2;
  if (!retryable) return { call: 'wait', waitMs: Math.min(START_POLL_MS, giveIn) };
  return { call: 'retry', try: o.tries + 1 };
}

/**
 * Runde 16: Beobachtung eines aktiven YouTube-Moments. Es gibt kein readyState und kein buffered, darum rs 0 und ahead 0: stabil wird er nur über
 * "spielt seit 2 s ohne Unterbrechung" (st 1, playingAtMs = Zeit seit dem letzten Eintritt in PLAYING, 0 wenn nicht spielend).
 * Runde 17: hat der Moment schon gespielt (playedBefore) und puffert er jetzt (st 3), gilt das sofort als Stockung (waitingMs über STALL_MS): kein Vorladen,
 * ein laufendes wird angehalten, auch nicht über die Frist. playedBefore bleibt auch zwischen den Pufferpausen wahr (Zustand 1 und 3 wechseln im Sekundentakt),
 * sonst griffe die Frist in jedem kurzen Zustand 1. Ohne bisheriges Spielen gilt die Frist wie in Runde 16.
 */
export function youtubeObs(o: { st: number; playingAtMs: number; userPaused: boolean; sinceMs: number; playedBefore?: boolean }): ActiveObs {
  const playing = o.st === 1 && o.playingAtMs > 0;
  const playedBefore = !!o.playedBefore;
  const waitingMs = playedBefore && o.st === 3 ? STALL_MS + 1 : 0;
  return { playedBefore, playing, playingMs: playing ? o.playingAtMs : 0, waitingMs, rs: 0, ahead: 0, userPaused: o.userPaused, sinceMs: o.sinceMs };
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
  // Runde 19: schwaches Netz, nur der nächste Nachbar. Ein ladender übernächster wird angehalten, ein wartender bleibt wartend.
  if (a.weak && n.rank === 2) return n.started ? { call: 'pause' } : { call: 'defer' };
  if (n.rank === 2 && !n.prevCanplay && n.prevStartedMs < DEADLINE_MS) return n.started ? { call: 'keep' } : { call: 'defer' };
  if (n.started) return { call: 'keep' };
  if (a.userPaused) return { call: 'start', why: 'paused' };
  // Runde 41: ein aktiver Moment ohne erstes Bild lässt den nächsten Nachbarn nach deadlineMs laden, auch im schwachen Netz (sonst gäbe es nie einen bereiten Nachbarn zum Wechseln)
  if (a.deadlineMs !== undefined && n.rank === 1 && !a.playedBefore && a.sinceMs >= a.deadlineMs) return { call: 'start', why: 'deadline' };
  // Runde 19: schwaches Netz: erst nach 3 s stabilem Spiel, keine Frist (ein hängender aktiver Moment bekäme sonst noch einen Konkurrenten)
  if (a.weak) return isWeakStable(a) ? { call: 'start', why: 'stable' } : { call: 'defer' };
  if (isStable(a)) return { call: 'start', why: 'stable' };
  if (!a.playedBefore && a.sinceMs >= (a.deadlineMs ?? DEADLINE_MS)) return { call: 'start', why: 'deadline' };
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
