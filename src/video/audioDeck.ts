// Ein einziges, dauerhaftes Audio-Element für den Audio-Reiter (Issue 11, Entscheidung 13).
//
// Ursache des Stopps nach jedem Track: iOS Safari erlaubt im Hintergrund kein play() auf einem Element, das nicht schon durch eine Geste
// gespielt hat, und Zeitgeber laufen gedrosselt. Früher hatte jeder Slot ein eigenes Audio-Element, der Wechsel zum nächsten Moment
// startete also ein anderes, nie berührtes Element und erst nach loadedmetadata. Darum gilt hier:
// - ein Element für alle Audio-Momente, es wird nie ersetzt und bleibt im DOM
// - der Wechsel setzt nur src und ruft play() auf, synchron im Ereignis-Handler (timeupdate oder ended), ohne await und ohne setTimeout davor
// - der Nachfolger ist vor dem Ende bekannt (arm), im Handler wird nichts mehr berechnet
// - Buchführung (gesehen, Signale, Warteschlange) läuft erst danach, in onAdvance
//
// Diese Datei kennt weder React noch die Warteschlange und importiert nichts aus ytApi (kein Kreis). Die Quelle aus dem Offline-Vorrat
// kommt über local(key), die Zeitzählung der Zustände entspricht den YouTube-Werten (0 Ende, 1 spielt, 2 Pause, 3 puffert).

import { isSilent, reduceSound, SOUND_NONE, type SoundObs } from '../moments/soundHint';

const ENDED = 0;
const PLAYING = 1;
const PAUSED = 2;
const BUFFERING = 3;

/** Abstand zum Ende des Ausschnitts, ab dem er als gespielt gilt (timeupdate kommt etwa alle 250 ms) */
const END_EPS = 0.05;
/** Abweichung der Position vom Start, ab der nach den Metadaten noch einmal gesprungen wird */
const SEEK_TOL = 0.75;

/**
 * Runde 20 (Diag 17.11. 07:46): ein Vorrats-Element meldete readyState 4 und "bereit", obwohl hinter der Startstelle nichts gepuffert war (duration gleich Startstelle),
 * beim Tausch folgten 5,6 s Stille. Bereit heißt jetzt: hinter der Startstelle liegen mindestens PREBUF_S Sekunden Puffer. 3 s Daten sind bei Tempo 2x noch 1,5 s Hörzeit,
 * genug für den Anlauf, während der Rest nachläuft. Mehr würde das Bereitwerden im schwachen Netz nur verzögern.
 */
export const PREBUF_S = 3;
/** Runde 20: so viel Puffer hinter der Position gilt als "es kommt etwas" (Anzeige: Laden oder Spielen) */
export const AHEAD_MIN_S = 0.5;
/** Runde 20: ein Puffer-Bereich zählt für eine Stelle, wenn er höchstens so weit danach beginnt (Sekunden, iOS startet Bereiche an Frame-Grenzen) */
const BUF_EPS = 0.5;
/** Runde 20: so lange wartet ein Vorrats-Eintrag mit zu dünnem Puffer, bevor der Seek einmal wiederholt wird (ms) */
export const POOL_NUDGE_MS = 10_000;

/** Runde 20: Puffer-Bereiche des Elements (TimeRanges oder Nachbau, start ist optional) */
export interface BufRanges {
  readonly length: number;
  start?(i: number): number;
  end(i: number): number;
}

/**
 * Runde 20: Ende des Puffer-Bereichs, der die Stelle t einschließt. undefined: das Gerät liefert keine Bereiche (fehlt, leer oder wirft). null: Bereiche da, keiner schließt t ein.
 */
export function bufferedEnd(b: BufRanges | null | undefined, t: number): number | null | undefined {
  try {
    if (!b || !(b.length > 0)) return undefined;
    let best: number | null = null;
    for (let i = 0; i < b.length; i++) {
      const st = b.start ? b.start(i) : 0;
      const en = b.end(i);
      if (st <= t + BUF_EPS && en >= t - 0.05 && (best === null || en > best)) best = en;
    }
    return best;
  } catch {
    return undefined;
  }
}

/**
 * Runde 20: ist ein Vorrats-Eintrag wirklich bereit? Die bisherige Bedingung (canplaythrough oder readyState 4, lokal 3) prüft der Aufrufer, rs reist nur mit für die Diagnose.
 * Hinter der Startstelle müssen Daten liegen. Mit Bereichen: einer schließt target ein und reicht
 * mindestens margin darüber hinaus. Ohne Bereiche (leer auf dem Gerät): duration endlich und größer als target + margin. duration gleich target (Abstand unter 1 s) ist nie bereit.
 */
export function poolEntryReady(o: { rs: number; target: number; dur: number; buffered?: BufRanges | null; margin?: number }): boolean {
  const margin = o.margin ?? PREBUF_S;
  if (Number.isFinite(o.dur) && o.dur - o.target < 1) return false;
  const end = bufferedEnd(o.buffered, o.target);
  if (end === undefined) return Number.isFinite(o.dur) && o.dur > o.target + margin;
  return end !== null && end >= o.target + margin;
}

/** Läuft ein Ausschnitt schon unverändert und bleiben weniger Sekunden, lohnt der Wechsel auf die geregelte Spur nicht mehr */
const RELEVEL_MIN_LEFT = 4;
/** So lange nach einer Unterbrechung des Kontexts warten, bevor auf die unveränderte Spur gewechselt wird (iOS setzt ihn oft von selbst fort) */
const CONTEXT_GRACE_MS = 1500;

/** Wie lange der erste Start auf die Blob-URL aus dem Vorrat wartet, bevor er vom Netz kommt (ms, Kaltstart, Brief 02) */
const HOLD_MS = 1200;

/** Runde 13: Abstände der Neustarts, wenn iOS direkt nach dem Sprung an die Startstelle ein "ended" meldet, ohne dass der Ausschnitt gespielt wurde (ms). Drei Versuche je Ausschnitt. */
export const EARLY_RESTART_MS = [150, 400, 1000];

/** So lange nach einem play() ohne Ergebnis hält der Deck weitere Anstöße (soundGuard, play des Feeds, canplay) vom selben Ausschnitt zurück, auch ohne Metadaten */
const KICK_INFLIGHT_MS = 1500;

/**
 * Issue 58: ein Ausschnitt bekommt genau einen Startversuch je Quelle. Solange das play() des Ausschnitts aussteht und noch keine Metadaten da sind (kalter Start,
 * Host liefert den späten Startpunkt langsam), oder es jünger als KICK_INFLIGHT_MS ist, tut jeder weitere Anstoß nichts. Max' Diag 11.11. zeigte play#4 bis #6
 * binnen 2 s auf demselben Ausschnitt. Ein neuer Ausschnitt (start, swap) ist nie betroffen.
 */
export function skipKick(s: { inflightAt: number; readyState: number }, now: number, why: string): boolean {
  // Ein Neustart nach vorzeitigem ended ersetzt das stille play() des Starts (es bleibt auf iOS für immer offen), die Versuche bremsen sich selbst über ihre Zeitgeber
  if (why === 'start' || why === 'swap' || why === 'restart' || why === 'wait') return false;
  if (s.inflightAt <= 0) return false;
  return s.readyState < 1 || now - s.inflightAt < KICK_INFLIGHT_MS;
}

/** Runde 22: kleiner Rückschritt hinter die Startstelle, damit currentTime unter der von iOS gemeldeten duration liegt und play() nicht auf 0 springt (Sekunden) */
export const STEP_BACK = 0.25;
/** Runde 22: so weit darf der Rückschritt vor den Schnittbeginn reichen (Sekunden Elementzeit) */
const STEP_BACK_FLOOR = 0.3;
/** Runde 22: Position mehr als so viele Sekunden vor target minus STEP_BACK gilt als vor dem Schnittbeginn */
export const START_SLACK = 2;
/** Runde 22: so viele Korrekturen der Position je Ausschnitt, danach Neuaufbau der Quelle */
export const POS_FIX_MAX = 3;

/** Runde 22: Position für play() aus dem Ende-Zustand: at minus STEP_BACK, nie unter 0 und nie vor startEl minus 0,3 s (startEl: Beginn des Ausschnitts in Elementzeit) */
export function stepBackPos(at: number, startEl: number): number {
  return Math.max(0, startEl - STEP_BACK_FLOOR, at - STEP_BACK);
}

/** Runde 22: Position für den Neustart an der Stelle at: im Ende-Zustand (ended, oder duration höchstens 0,1 s hinter at, wie iOS es bei teilweise geladener Quelle meldet) mit Rückschritt */
export function restartPos(o: { ended: boolean; dur: number; at: number; startEl: number }): number {
  const endState = o.ended || (Number.isFinite(o.dur) && o.dur > 0 && o.dur <= o.at + 0.1);
  return endState ? stepBackPos(o.at, o.startEl) : o.at;
}

/** Runde 22: liegt die Position deutlich vor dem Schnittbeginn (Sprung auf den Folgenanfang)? Ein Ausschnitt nahe 0 hat kein Davor. */
export function positionBeforeStart(o: { t: number; target: number }): boolean {
  return Number.isFinite(o.t) && o.t < o.target - STEP_BACK - START_SLACK;
}

/** Runde 17: Toleranz vor clip.end, ab der ein ended als Ende des Ausschnitts gilt (Sekunden Elementzeit) */
export const END_TOL = 0.25;
/** Runde 17: ein ended so nah vor duration gilt als echtes Ende der Quelle (Sekunden) */
export const END_NEAR_DUR = 1.5;

/** Runde 18: so viele Sekunden muss ein Ausschnitt in diesem Element gelaufen sein, bevor eine Dauer nahe der Position als Ende der Quelle zählt */
export const END_MIN_ADVANCE = 2;

/**
 * Runde 17 (Diag 16.11.): iOS meldete "ended" direkt an der Startstelle (Tausch auf ein Vorrats-Element, direkter Start) oder hielt ended=true bei stehender Zeit.
 * Ein ended zählt nur, wenn es plausibel ist: die Position liegt am Ende des Ausschnitts (t plus offset, minus END_TOL), oder höchstens END_NEAR_DUR vor duration
 * (endlich und größer 0). Ohne clip.end und ohne gültige duration ist kein ended plausibel.
 * Runde 18 (Diag 16.11. abends): bei teilweise geladener Quelle meldet iOS eine duration nahe der Position, die Dauer allein belegt kein Ende. Darum gilt der Weg über
 * duration nur, wenn die Position seit Start oder letzter Wiederherstellung um mindestens END_MIN_ADVANCE gewachsen ist (advanced, Sekunden). Ein ended an der
 * Startstelle ist damit immer falsch.
 */
export function plausibleEnd(o: { t: number; dur: number; clipEnd: number | undefined; offset: number; advanced: number }): boolean {
  if (!Number.isFinite(o.t)) return false;
  if (o.clipEnd !== undefined && Number.isFinite(o.clipEnd) && o.t + o.offset >= o.clipEnd - END_TOL) return true;
  return Number.isFinite(o.dur) && o.dur > 0 && o.t >= o.dur - END_NEAR_DUR && o.advanced >= END_MIN_ADVANCE;
}

/** Runde 21: Fenster nach Beginn einer Wiederherstellung, in dem ein weiteres ended nicht gewertet wird (ms) */
export const ENDED_DEBOUNCE_MS = 300;
/**
 * Runde 21 (Geräteprotokoll): nach "false ended ... recovering" folgte Millisekunden später ein zweites ended mit t=0 und dur=0, das unnötig den Neuaufbau der Quelle auslöste.
 * Gilt nur für ein ended, das plausibleEnd nicht als echtes Ende wertet. Grund oder null (dann wird es wie bisher gewertet):
 * "recovering", wenn seit Beginn einer Wiederherstellung weniger als ENDED_DEBOUNCE_MS vergangen sind, "empty", wenn duration 0 oder nicht endlich ist und t unter 0,5 liegt.
 */
export function ignoreEnded(o: { sinceRecoverMs: number; t: number; dur: number; target?: number }): 'recovering' | 'empty' | null {
  // Runde 22: ein ended deutlich vor dem Schnittbeginn ist der Sprung auf 0 nach play() im Ende-Zustand, kein Echo. Es wird nie ignoriert (der Positionswächter holt die Stelle zurück).
  if (o.target !== undefined && positionBeforeStart({ t: o.t, target: o.target })) return null;
  if (o.sinceRecoverMs >= 0 && o.sinceRecoverMs < ENDED_DEBOUNCE_MS) return 'recovering';
  if ((!Number.isFinite(o.dur) || o.dur === 0) && Number.isFinite(o.t) && o.t < 0.5) return 'empty';
  return null;
}

/** Runde 17: Zeitproben seit dem letzten Zurücksetzen (erste, letzte, Anzahl) */
export interface TimeSamples {
  first: number;
  last: number;
  n: number;
}
/** Ein Sprung größer als das zwischen zwei Proben ist ein Seek, kein Fortschritt (Sekunden) */
const SAMPLE_JUMP = 5;
/** Runde 17: Zuwachs der Position über mindestens zwei Proben, ab dem das Element als laufend gilt (Sekunden) */
export const ADVANCE_MIN = 0.25;

/** Neue Probe der Position. Rückwärts oder ein Sprung vorwärts beginnt die Reihe neu. */
export function sampleTime(prev: TimeSamples | null, t: number): TimeSamples | null {
  if (!Number.isFinite(t)) return null;
  if (!prev || t < prev.last || t - prev.last > SAMPLE_JUMP) return { first: t, last: t, n: 1 };
  return { first: prev.first, last: t, n: prev.n + 1 };
}

/** Runde 17: mindestens zwei Proben und die Position ist um mehr als ADVANCE_MIN gewachsen */
export function timeAdvancing(s: TimeSamples | null): boolean {
  return !!s && s.n >= 2 && s.last - s.first > ADVANCE_MIN;
}

/** Runde 17: so lange darf die Position bei spielendem Element stehen, bevor es als eingefroren gilt (ms) */
export const FROZEN_MS = 4000;
/** Bewegung unter dieser Größe zählt als Stillstand (Sekunden) */
const FROZEN_EPS = 0.05;

/**
 * Runde 17: Wächter gegen stehende Zeit. active heißt: Wunsch zu spielen, nicht pausiert, readyState 3 oder mehr, Ausschnitt nicht zu Ende, Seite sichtbar, Start schon
 * geliefert. Ohne active (auch beim normalen Puffern) beginnt die Messung neu. Bewegt sich die Position, beginnt sie ebenfalls neu.
 */
export function frozen(o: { prev: { t: number; at: number } | null; t: number; now: number; active: boolean }): { next: { t: number; at: number } | null; frozen: boolean } {
  if (!o.active || !Number.isFinite(o.t)) return { next: null, frozen: false };
  if (!o.prev || Math.abs(o.t - o.prev.t) > FROZEN_EPS) return { next: { t: o.t, at: o.now }, frozen: false };
  return { next: o.prev, frozen: o.now - o.prev.at >= FROZEN_MS };
}

/** Runde 17: höchstens so viele Wiederherstellungen je Ausschnitt (erste: Position und play(), zweite: Quelle neu aufbauen) */
export const CLIP_RECOVER_MAX = 2;
export type RecoverStep = 'soft' | 'rebuild' | 'defer' | 'giveup';
/**
 * Runde 17: welche Wiederherstellung als nächste. Das erste Mal (n === 0), bei falschem Ende wie bei stehender Zeit mit ended=true: Position setzen und play() (soft).
 * Runde 18: stehende Zeit mit ended=false ist Puffern und kommt hier nie an. Jedes weitere Mal (n >= 1): Quelle neu aufbauen (rebuild), verdeckt erst bei der
 * Rückkehr (defer, kein Quellwechsel verdeckt). Nach CLIP_RECOVER_MAX: aufgeben.
 */
export function recoverStep(o: { n: number; kind: 'ended' | 'frozen'; hidden: boolean }): RecoverStep {
  if (o.n >= CLIP_RECOVER_MAX) return 'giveup';
  if (o.n === 0) return 'soft';
  return o.hidden ? 'defer' : 'rebuild';
}

/** Runde 24: so nah (Sekunden) muss die Position an target liegen, damit sie als bestätigt gilt */
export const POS_CONFIRM_TOL = 0.5;
/** Runde 24: so lange (ms) bleibt das Element stumm, bis die Position bestätigt ist, danach ein letzter Sprung und Ton */
export const POS_CONFIRM_MS = 1500;
/** Runde 24: Position bestätigt: Metadaten da, kein Seek unterwegs, currentTime mindestens target minus 0,5 und bei target über 2 nicht unter 1 (Sprung auf den Folgenanfang) */
export function positionConfirmed(o: { t: number; target: number; rs: number; seeking: boolean }): boolean {
  if (o.rs < 1 || o.seeking || !Number.isFinite(o.t)) return false;
  if (o.t < o.target - POS_CONFIRM_TOL) return false;
  return !(o.target > 2 && o.t < 1);
}

/** Runde 24: höchstens so viele "false ended"-Wiederherstellungen je Moment in diesem Fenster (ms), danach Neuaufbau, danach gestört */
export const FALSE_ENDED_MAX = 3;
export const FALSE_ENDED_WINDOW_MS = 5000;
export type FalseEndedStep = 'recover' | 'rebuild' | 'broken';
/**
 * Runde 24 (Geräteprotokoll 18.11.: rund 50 gleiche Zeilen "false ended" bei einem Moment): Schleifensicherung. Zählt die falschen Enden des Moments im Fenster
 * (dieses eingeschlossen). Bis FALSE_ENDED_MAX: normale Wiederherstellung (recover). Das nächste: Neuaufbau der Quelle (rebuild), der Zähler beginnt neu.
 * Kommt die Schleife nach dem Neuaufbau wieder über die Grenze: gestört (broken), der Moment wird gemeldet und der Feed geht weiter.
 */
export function falseEndedGate(o: { times: readonly number[]; now: number; rebuilt: boolean }): { times: number[]; step: FalseEndedStep } {
  const times = [...o.times.filter((x) => o.now - x <= FALSE_ENDED_WINDOW_MS), o.now];
  if (times.length <= FALSE_ENDED_MAX) return { times, step: 'recover' };
  return { times: o.rebuilt ? times : [], step: o.rebuilt ? 'broken' : 'rebuild' };
}

/**
 * Runde 25 (Geräteprotokoll 18.11. 18:44): iOS setzte nach dem Sprung in einen noch nicht geladenen Bereich die duration auf currentTime und meldete ended, obwohl die Datei länger ist.
 * Ein ended, dessen Position mehr als REAL_END_GAP vor der größten je gemeldeten Dauer liegt, ist kein Ende: das Element wartet auf Daten am Ziel.
 */
export const REAL_END_GAP = 2;
/** Runde 25: so lange (ms) wartet ein Moment nach so einem Ende auf Daten, danach greift die bisherige Kette (Wiederherstellung, Neuaufbau, Schleifensicherung) */
export const DATA_WAIT_MS = 6000;
/** Runde 25: Abfrage der Daten am Ziel zusätzlich zu den Ereignissen (ms) */
export const DATA_POLL_MS = 150;
/** Runde 25: kamen bis dahin keine Daten (kein progress), folgt genau ein sanfter Anstoß (ms) */
export const DATA_NUDGE_MS = 1500;
/** Runde 25: so viele Wartevorgänge je Moment, danach gilt die bisherige Kette */
export const DATA_WAIT_MAX = 3;
/** Runde 25: so viele Sekunden Puffer hinter der Stelle gelten als "Daten da" */
const DATA_AHEAD_S = 1;

/** Runde 25: liegt die Position deutlich vor der echten Dauer? Ohne bekannte echte Dauer nie. */
export function beforeRealEnd(o: { t: number; real: number | undefined }): boolean {
  return o.real !== undefined && Number.isFinite(o.real) && Number.isFinite(o.t) && o.t < o.real - REAL_END_GAP;
}

/**
 * Runde 25: sind am Ziel (at) Daten da? Entweder deckt ein Puffer-Bereich at plus DATA_AHEAD_S, oder das Element steht mit readyState 3 oder mehr nahe at und seine duration
 * liegt wieder hinter at (iOS setzt sie beim falschen Ende auf die Position).
 */
export function dataReady(o: { at: number; t: number; dur: number; rs: number; buffered?: BufRanges | null }): boolean {
  const end = bufferedEnd(o.buffered, o.at);
  if (typeof end === 'number' && end >= o.at + DATA_AHEAD_S) return true;
  const durOk = !Number.isFinite(o.dur) || o.dur - o.at >= 1;
  return o.rs >= 3 && Math.abs(o.t - o.at) <= 1 && durOk;
}

/** Runde 18: so lange gilt das Netz nach "pool slow" oder langem Warten auf playing als schwach (ms) */
export const WEAK_NET_MS = 5 * 60_000;
/** Runde 18: braucht der aktive Moment so lange bis playing, gilt das Netz als schwach (ms) */
export const WEAK_PLAY_MS = 5000;
/**
 * Runde 26 (Diag 19.11. 09:16:47): so viele zuletzt verlassene Momente bleiben geladen und pausiert im Deck, damit das Zurückwischen ohne Kaltstart tauscht.
 * Jeder behaltene Moment kostet einen Platz des Vorrats (Elemente je Spur bleiben POOL + 1: aktiv, behalten, Vorrat). Der Platz kommt vom am weitesten vorausliegenden Eintrag.
 * Zwei Momente zurück kosten einen zweiten Platz (Vorrat dann nur noch 3), darum bleibt es bei einem.
 */
export const KEEP_PREV = 1;
/** Runde 26: ein Vorrats-Eintrag, der in so kurzer Zeit bereit wird (ms), zählt als Zeichen für ein gutes Netz (zwei in Folge heben "schwach" auf) */
export const WEAK_OK_READY_MS = 3000;
/** Runde 26: ein Netzstart, der in so kurzer Zeit spielt (ms), zählt ebenso */
export const WEAK_OK_START_MS = 2000;
/** Runde 26: so viele schnelle Ereignisse in Folge heben "schwach" auf */
export const WEAK_OK_RUN = 2;
/** Runde 18: im schwachen Netz lädt ein Vorrats-Eintrag nach einem Fehler frühestens nach dieser Zeit neu (ms), höchstens RELOAD_MAX mal je Ausschnitt */
export const RELOAD_WAIT_MS = 15_000;
export const RELOAD_MAX = 2;

/**
 * Runde 18 (Diag 16.11., Mobilfunk): wie viele neue Netz-Abrufe der Vorrat jetzt starten darf. inflight zählt Einträge mit Netz, die weder bereit noch
 * fehlgeschlagen sind (lokale zählen nicht). Spielt der aktive Moment nicht, oder ist das Netz schwach: höchstens 1 in Arbeit. Sonst höchstens 2.
 */
export function poolBudget(o: { activePlaying: boolean; weakNet: boolean; inflight: number }): number {
  const cap = o.activePlaying && !o.weakNet ? 2 : 1;
  return Math.max(0, cap - Math.max(0, o.inflight));
}

/** Runde 18: darf ein Vorrats-Eintrag nach einem Fehler neu laden? Ohne schwaches Netz sofort (wie bisher). Sonst nach RELOAD_WAIT_MS, höchstens RELOAD_MAX mal. */
export function reloadGate(o: { weakNet: boolean; fails: number; sinceMs: number }): 'now' | 'wait' | 'never' {
  if (!o.weakNet || o.fails <= 0) return 'now';
  if (o.fails > RELOAD_MAX) return 'never';
  return o.sinceMs >= RELOAD_WAIT_MS ? 'now' : 'wait';
}

/** Ereignisse, in denen iOS ein play() annimmt (ein Tipp ohne Bewegung). pointerdown und das Ende eines Wischs gehören nicht dazu. */
const ACTIVATING = new Set(['pointerup', 'touchend', 'click', 'keydown']);
/** So lange nach einer solchen Geste (ms) darf ein Anstoß auch dann spielen, wenn die Tippfläche steht */
const GESTURE_WINDOW_MS = 120;
/** So lange wartet die Diag-Zeile "deck: gesture ... unlocked" auf die Ergebnisse der Freischaltung, bevor sie mit dem Stand schreibt (ms) */
const UNLOCK_LINE_MS = 800;

/**
 * Runde 29: auf einer Netzquelle wird nie play() gerufen, bevor ihr Sprung auf das Ziel gesetzt und abgeschlossen ist (Hypothese aus den Geräteprotokollen 18. bis 20.11., am iPhone unbelegt).
 * true: Freigeschaltet wird nur mit einer stillen Inline-Quelle (SILENT) auf Elementen ohne Netzquelle, nie mit einer Netzquelle. Ein freigeschaltetes Element bekommt seinen ersten play()
 * erst nach dem Sprung (seeked). Ein Element mit Netzquelle wird nicht angespielt, es schaltet sich im Wisch frei.
 * false: das Verhalten von da2670a (jede Geste spielt jeden Eintrag stumm an, ein Start spielt sofort vor den Metadaten).
 */
export const UNLOCK_SILENT = true;
/**
 * Runde 30 (Arbeitshypothese aus den Geräteprotokollen 18. bis 20.11., eine Korrelation, am iPhone unbelegt): ein play() mit muted=true auf einer Netzquelle lässt auf iOS 18.7 (Standalone)
 * die Dauer dieser Quelle dauerhaft einbrechen, sofort oder beim späteren Tausch.
 * true: Netzquellen spielen nie stumm. Das Deck schreibt muted nie auf ein Element mit Netzquelle, ein Start ohne Geste oder mit "Ton aus" wartet pausiert auf den Tipp
 * (Tippfläche), der Tipp schaltet frei und spielt im selben Handler laut. Vor der ersten Geste lädt der Vorrat nichts, die erste Geste schaltet alle Elemente still frei (SILENT), danach füllt er sich.
 * false (zusammen mit UNLOCK_SILENT = false): das Verhalten von da2670a.
 */
export const NEVER_MUTED = true;
/** Runde 30: so lange wartet die Öffnung des Vorrats auf die stillen Freischaltversuche (ms), danach öffnet er trotzdem */
const POOL_OPEN_MS = 1500;
/** Runde 29: so lange wartet der erste play() nach dem Sprung auf seeked (ms), danach spielt er trotzdem */
export const JUMP_WAIT_MS = 1500;
/** Runde 29: so lange wartet der erste play() auf die Metadaten (ms), danach spielt er trotzdem (Netz hängt, nie stehen bleiben) */
const JUMP_META_MS = 8000;
/** Runde 27: Ausweichen auf ein frisches Element: so viel früher (Sekunden Elementzeit) liegt dort das Ziel */
export const DODGE_BACK = 1;
/** Runde 27: so viele Sekunden Spielzeit auf dem frischen Element, bis "fresh element ... ok" gilt */
export const FRESH_OK_S = 2;

/** Null Sekunden Stille: schaltet das Element durch eine Geste frei, bevor der erste echte Moment kommt */
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

/** Größe des Element-Vorrats (Entscheidung 52, Brief 14): so viele nächste Momente liegen fertig geladen in eigenen Elementen, plus das aktive */
export const POOL = 5;

/** Aus so vielen nächsten Momenten wählt der Vorrat seine POOL Ausschnitte, lokale zuerst (Brief 14b, Entscheidung 45). Entspricht dem Fenster der Vorrats-Tiefe (3 der nächsten 6). */
export const POOL_WINDOW = 6;

/** Runde 12: Zeitgeber der Nachprüfung zurückgestellter Abrufe. Runde 18: er startet keinen zusätzlichen Abruf mehr über das Budget (poolBudget) hinaus. */
export const FILL_DEFER_MS = 4000;

type Lane = 'plain' | 'level';

/** Ein Element des Vorrats: hält den Anfang eines Ausschnitts fertig geladen (Entscheidung 47 und 52, Brief 11 und 14) */
interface PoolEntry {
  clip: DeckClip;
  el: DeckEl;
  lane: Lane;
  /** Warum diese Spur (Diagnose, Anzeige der Lautheit) */
  why: string;
  chain: { linear: () => number } | null;
  local: boolean;
  offset: number;
  /** Position im Element, an der der Ausschnitt beginnt */
  target: number;
  /** Metadaten sind da */
  meta: boolean;
  /** canplaythrough kam, seit die Position zuletzt gesetzt wurde */
  cpt: boolean;
  ready: boolean;
  /** readyState, als der Eintrag bereit wurde. Fällt er danach auf 0, hat iOS das Element verworfen (Schritt 5). 0 heißt: nie Daten gesehen (kein Maßstab). */
  rsAtReady: number;
  /** Runde 20: der Eintrag erfüllte die alte Bedingung, aber hinter der Startstelle lag noch kein Puffer (Zeile steht, Seek-Anstoß ist geplant) */
  thin: boolean;
  t0: number;
  /** Runde 26: "pool slow" wurde gemeldet (8 s ohne Bereitschaft) */
  slow?: boolean;
}

/** Stand eines Eintrags für Host und Diagnose */
export interface PoolInfo {
  key: string;
  id: string;
  ready: boolean;
}

export interface DeckClip {
  /** localKey(videoId, start, end), gleicher Schlüssel wie im Offline-Vorrat */
  key: string;
  /** videoId des Moments (nur für die Diagnose) */
  id: string;
  /** Quelle über das Netz */
  url: string;
  start: number;
  end: number | undefined;
  /** Anpassung der Lautheit in dB (Entscheidung 16), fehlt sie oder ist 0, bleibt der Ausschnitt unverändert */
  gain?: number;
}

export interface DeckSink {
  /** Zustand des Elements, solange dieser Player es besitzt */
  state(st: number): void;
  error(): void;
  /** Runde 24: der Moment ist gestört (Schleife aus falschem Ende trotz Neuaufbau): der Feed geht zum nächsten. Fehlt es, gilt error(). */
  broken?(): void;
  /** Ton oder Wiedergabe des Elements hat sich geändert (volumechange, playing, pause, abgelehntes play): Hinweis neu lesen */
  sound?(): void;
  /** Messung am Element für die Untertitel (Issue 15): Quellzeit, Tempo, Ton läuft. Bei Quell- und Spurwechsel bleibt die Zeit stehen (playing false). */
  time?(t: number, rate: number, playing: boolean): void;
}

export interface LocalClip {
  url: string;
  /** Tonzeit des ersten Bytes der Quelle */
  offset: number;
}

/** Das Wenige, das der Deck vom Element braucht (HTMLAudioElement erfüllt es, im Test steht ein Nachbau) */
export interface DeckEl {
  src: string;
  currentTime: number;
  readonly paused: boolean;
  readonly ended: boolean;
  readonly readyState: number;
  readonly duration: number;
  muted: boolean;
  readonly volume?: number;
  playbackRate: number;
  defaultPlaybackRate: number;
  preservesPitch?: boolean;
  removeAttribute?(name: string): void;
  readonly error?: { code: number } | null;
  readonly buffered?: BufRanges;
  /** Runde 25: suchbarer Bereich (Ende gilt als untere Grenze der echten Dauer) */
  readonly seekable?: BufRanges;
  /** Runde 20: ein Seek läuft noch (seeked kommt danach) */
  readonly seeking?: boolean;
  /** Runde 27: nur für die Diagnose "deck: collapse" */
  readonly networkState?: number;
  play(): Promise<void> | undefined;
  pause(): void;
  load(): void;
  addEventListener(type: string, fn: () => void): void;
}

export interface DeckDeps {
  /** Ausschnitt aus dem Offline-Vorrat, falls vorhanden */
  local: (key: string) => LocalClip | undefined;
  /** Der Ausschnitt aus dem Vorrat war nicht abspielbar: vergessen, vom Netz neu laden */
  dropLocal: (key: string) => void;
  /** Element anlegen (Standard: <audio> im Dokument, unsichtbar). level: Element der geregelten Spur (CORS angefordert) */
  make?: (level: boolean) => DeckEl;
  /** Spurwahl je Ausschnitt (Lautheit, Entscheidung 16): geregelte Spur über Web Audio oder unverändert */
  lane?: (clip: DeckClip, local: boolean, forcePlain: boolean) => { lane: 'plain' | 'level'; why: string };
  /** Kette hinter das Element der geregelten Spur legen und die Anpassung setzen. null: nicht möglich, der Ausschnitt läuft unverändert. */
  chain?: (el: DeckEl, gainDb: number) => { linear: () => number } | null;
  /** Die Quelle lud in der geregelten Spur (ok) oder erst danach unverändert (bad): Host merken */
  host?: (url: string, state: 'ok' | 'bad') => void;
  /** Läuft Web Audio gerade? */
  running?: () => boolean;
  /** Würde der Ausschnitt geregelt laufen, aber der Kontext läuft noch nicht (resume() steht aus) oder das Urteil der CORS-Probe für seinen Host fehlt noch: Versprechen, das sich löst, sobald beides da ist (true), oder nach der Frist (false). Sonst null. */
  settle?: (clip: DeckClip, forcePlain: boolean) => Promise<boolean> | null;
  /** Web Audio versagt in dieser Sitzung */
  broken?: (why: string) => void;
  /** Steht die Seite im Hintergrund (Standard: visibilityState hidden) */
  hidden?: () => boolean;
  /** Media Session des Betriebssystems setzen (Standard: navigator.mediaSession.playbackState), why für die Diagnose */
  playbackState?: (s: 'playing' | 'paused', why: string) => void;
  /** Runde 29: false gilt das Verhalten von da2670a (UNLOCK_SILENT), Standard die Konstante */
  unlockSilent?: boolean;
  /** Runde 30: false gilt das Verhalten von da2670a (NEVER_MUTED), Standard die Konstante */
  neverMuted?: boolean;
  /** Runde 27: false schaltet das Ausweichen auf ein frisches Element ab (Tests der bestehenden Kette), Standard true */
  dodge?: boolean;
  /** Element-Vorrat (Entscheidung 47 und 52): fill() lädt die nächsten POOL Ausschnitte in eigene Elemente vor, swapNext() tauscht nur die Rollen. Aus: fill() tut nichts. */
  standby?: boolean;
}

const defaultMake = (level: boolean): DeckEl => {
  const a = document.createElement('audio');
  a.preload = 'auto';
  // Tonhöhe bleibt bei Tempo 1.5x und 2x erhalten
  a.preservesPitch = true;
  (a as unknown as { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
  // Nur die geregelte Spur fordert CORS an, sonst gäbe Web Audio für Quellen ohne Freigabe Stille aus
  if (level) a.crossOrigin = 'anonymous';
  a.dataset.lane = level ? 'level' : 'plain';
  a.setAttribute('playsinline', '');
  a.style.display = 'none';
  a.dataset.core = 'audio-deck';
  document.body.appendChild(a);
  return a as unknown as DeckEl;
};
const defaultHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

/** Netzquellen springen mit dem Medienfragment direkt an den Start, damit vor dem Sprung kein Ton vom Anfang der Datei läuft */
/** Hostname einer Quelle für die Diagnose, "unknown" wenn die URL nicht zu lesen ist */
const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname || 'unknown';
  } catch {
    return 'unknown';
  }
};

export class AudioDeck {
  /** Das aktive Element. Je Spur gibt es höchstens POOL + 1 (aktiv und die des Vorrats), alle bleiben im DOM und werden nie ersetzt. */
  private el: DeckEl | null = null;
  private pool: Record<Lane, DeckEl[]> = { plain: [], level: [] };
  private laneOf = new Map<DeckEl, Lane>();
  private lane: Lane = 'plain';
  /** Der Vorrat in Reihenfolge der Warteschlange (Brief 14): je Eintrag ein Element mit dem Anfang eines der nächsten Momente */
  private entries: PoolEntry[] = [];
  /** Runde 26: zuletzt verlassene Momente, geladen und pausiert (siehe KEEP_PREV), ältester zuerst. Nie zugleich im Vorrat. */
  private kept: PoolEntry[] = [];
  /** Runde 26: schnelle Netz-Ereignisse in Folge (hebt "schwach" auf), der aktive Moment kam per Netzstart (nicht per Tausch) */
  private weakFast = 0;
  private coldNet = false;
  /** Runde 12: letzter Aufruf von fill (für das Nachfüllen nach einer Zurückstellung), zusätzliche Netz-Abrufe durch den Zeitgeber, Zeile schon geschrieben, Zeitgeber */
  private lastFill: { clips: readonly DeckClip[]; locOf: (key: string) => LocalClip | undefined; activePending: boolean } | null = null;
  private deferNoted = false;
  /** Runde 18: schwaches Netz bis zu diesem Zeitpunkt (0: nicht schwach), Zeitgeber für die Rückmeldung, Fehler je Ausschnitt (Anzahl, letzter Zeitpunkt), fill läuft gerade */
  private weakUntil = 0;
  private weakTimer: ReturnType<typeof setTimeout> | null = null;
  private fails = new Map<string, { n: number; at: number }>();
  private inFill = false;
  /** Runde 18: Beginn des aktuellen Ausschnitts (Zeit bis playing), Schlüssel, für den "buffering inferred" schon in der Diag steht, Zahl der progress-Ereignisse des aktiven Elements */
  private clipAt = 0;
  private bufNoted = '';
  /** Runde 20: nach Tausch oder Neustart ohne Puffer hinter der Position meldet playingNow kein "spielt", bis Daten da sind */
  private guard: DeckEl | null = null;
  private prog = 0;
  private deferTimer: ReturnType<typeof setTimeout> | null = null;
  /** Der Vorrat wurde verbraucht oder verworfen: sobald er wieder voll ist, meldet das Deck "pool refill" */
  private depleted = false;
  /** Elemente, auf denen ein play() in einer Geste wirklich angenommen wurde (Promise erfüllt). iOS erlaubt nur ihnen später play() ohne Geste. Ein Versuch allein zählt nicht. */
  private unlockedEls = new WeakSet<DeckEl>();
  /** Laufende Freischaltversuche je Element: Zahl, und die Stummschaltung vor dem ersten Versuch (sie kommt zurück, sobald der letzte Versuch endet) */
  private probes = new WeakMap<DeckEl, { n: number; muted: boolean }>();
  /** Die Geste, die gerade freischaltet (Zähler und Ereignisname), und je Geste die Zahl der offenen Versuche, damit die Diag-Zeile erst nach den Ergebnissen kommt */
  private gid = 0;
  private lastGesture = '';
  private gestureOpen = new Map<number, number>();
  private lineDone = new Set<number>();
  private lastLoggedA = 0;
  /** Zeitpunkt der letzten Geste, in der iOS ein play() annimmt */
  private actAt = 0;
  /** Runde 29: Zeitpunkt der letzten Geste jeder Art (unlock-Aufruf) */
  private gestAt = 0;
  /** Schlüssel des Ausschnitts, dessen Start oder Tausch abgelehnt wurde (NotAllowedError): bis zur nächsten Geste kein play() von selbst */
  private needTapKey = '';
  private needTapNoted = false;
  /** Start oder Tausch wurde ohne Geste abgelehnt: der Host zeigt die Tippfläche (id des Ausschnitts, Anlass) */
  onRefused: ((id: string, why: string) => void) | null = null;
  /** play() des aktiven Elements wurde erfüllt (nach jedem "deck play#N ok"): der Host füllt danach den Vorrat auf */
  onPlayed: (() => void) | null = null;
  /** Ein Eintrag fiel sichtbar aus (Fehler), der Host soll den Vorrat neu füllen */
  onNeedFill: (() => void) | null = null;
  /** Ein Eintrag des Vorrats wurde bereit (Brief 22): Zahl der bereiten Elemente. Der Host schreibt "pool n/5 ready" und löst ein vorgemerktes Weiter ein. */
  onReady: ((ready: number) => void) | null = null;
  private loudInfo: { db: number; how: string } = { db: 0, how: 'unchanged: no value' };
  private loudLinear: (() => number) | null = null;
  /** Quelle, die in der geregelten Spur nicht lud. Lädt sie danach unverändert, gilt der Host als ohne CORS. */
  private trialFailed: string | null = null;
  /** relevel() wartet gerade auf das Urteil der Probe */
  private relevelWait = false;
  private levelPrimed = false;
  /** Stelle (Tonzeit der Quelle), ab der der Ausschnitt zuletzt gestartet wurde: Rückfälle springen dorthin zurück, nie an den Anfang */
  private resumeFrom = 0;
  /** Der Ausschnitt, der gerade im Element steckt */
  clip: DeckClip | null = null;
  private sink: DeckSink | null = null;
  private offset = 0;
  private isLocal = false;
  private rate = 1;
  /** Der Mensch oder die App will Ton (false nach pause()) */
  private want = false;
  /** Der Ausschnitt ist zu Ende gespielt, bis der nächste geladen wird */
  private done = true;
  private target = 0;
  private unlocked = false;
  private refusedKey = '';
  private nudged = false;
  /** Runde 18: gilt das Netz gerade als schwach? */
  private weakNet(): boolean {
    return this.weakUntil > Date.now();
  }

  /** Runde 19: nur lesen, der Video-Feed fragt den Merker ab (Nachbar-Vorladen im schwachen Netz) */
  isWeakNet(): boolean {
    return this.weakNet();
  }

  /** Runde 18: schwaches Netz merken (WEAK_NET_MS ab jetzt). Diag einmal beim Wechsel, eine Rückmeldung beim Ablauf. */
  private markWeak() {
    const was = this.weakNet();
    this.weakUntil = Date.now() + WEAK_NET_MS;
    this.weakFast = 0;
    if (was) return;
    this.diag('deck: weak net, pool one at a time');
    const arm = (ms: number) => {
      this.weakTimer = setTimeout(() => {
        this.weakTimer = null;
        const left = this.weakUntil - Date.now();
        if (left > 0) return arm(left);
        this.weakUntil = 0;
        this.diag('deck: net ok, pool two at a time');
        this.refillDeferred();
      }, ms);
    };
    if (this.weakTimer) clearTimeout(this.weakTimer);
    arm(WEAK_NET_MS);
  }

  /** Runde 26: ein schnelles Netz-Ereignis (Eintrag bereit oder Netzstart spielt). WEAK_OK_RUN in Folge heben "schwach" auf, ein langsames setzt die Zählung zurück. */
  private noteFast(ms: number, limit: number, what: string) {
    if (!this.weakNet()) {
      this.weakFast = 0;
      return;
    }
    if (ms > limit) {
      this.weakFast = 0;
      return;
    }
    if (++this.weakFast < WEAK_OK_RUN) return;
    this.weakFast = 0;
    this.weakUntil = 0;
    if (this.weakTimer) clearTimeout(this.weakTimer);
    this.weakTimer = null;
    this.diag(`deck: weak net off (${what} ${ms} ms, ${WEAK_OK_RUN} in a row)`);
    this.refillDeferred();
  }

  /** Das Element spielt gerade (Ereignis playing kam, seitdem weder Pause noch Puffern noch neue Quelle) */
  private live = false;
  /** Seit dem Laden dieses Ausschnitts kam mindestens ein playing */
  private played = false;
  private plays = 0;
  /** Zeitpunkt des Startversuchs, dessen play() noch aussteht (0: keiner), und seine Marke, damit ein altes Ergebnis einen neuen Ausschnitt nicht freigibt */
  private inflightAt = 0;
  private kickTok = 0;
  private skipNoted = false;
  /** Runde 13: Zahl der Neustarts nach vorzeitigem ended für den aktuellen Ausschnitt, Zeitgeber des nächsten Versuchs, Aufgabe-Zeile schon geschrieben */
  private earlyN = 0;
  private earlyTimer: ReturnType<typeof setTimeout> | null = null;
  private earlyGaveUp = false;
  /** Runde 17: Zeitproben für "läuft" aus fortschreitender Position, Messung gegen stehende Zeit, Wiederherstellungen je Ausschnitt (Schlüssel, Zahl, letzter Zeitpunkt, Neuaufbau verdeckt vertagt, aufgegeben), play() des Ausschnitts wurde erfüllt */
  private samp: TimeSamples | null = null;
  private froz: { t: number; at: number } | null = null;
  private recov = { key: '', n: 0, at: 0, pending: false, gaveUp: false };
  private rebuilding = false;
  /** Runde 22: Korrekturen der Position vor dem Schnittbeginn je Ausschnitt */
  private posFix = { key: '', n: 0 };
  /** Runde 24: Schleifensicherung gegen wiederholtes falsches Ende (siehe falseEndedGate) */
  private fe = { key: '', times: [] as number[], rebuilt: false, dead: false };
  /** Runde 24: stumm bis die Position bestätigt ist (real: der Ton-Zustand, den Host und Entsperrung wollen) */
  private posHold: { el: DeckEl; key: string; id: string; target: number; real: boolean; t0: number; tick: ReturnType<typeof setInterval>; stop: ReturnType<typeof setTimeout> } | null = null;
  /** Runde 25: größte je gemeldete endliche Dauer je Moment (Elementzeit), Wartevorgänge je Moment, der laufende Wartevorgang */
  private realDur = new Map<string, number>();
  private dw = { key: '', n: 0, timedOut: false };
  private dataWait: { el: DeckEl; key: string; id: string; at: number; t0: number; prog0: number; nudged: boolean; tick: ReturnType<typeof setInterval>; stop: ReturnType<typeof setTimeout> } | null = null;
  /** Runde 24: für diesen Ausschnitt steht die Zeile "pos set" schon */
  private posLineKey = '';
  /** Runde 22: Metadaten da und Startsprung gesetzt, erst dann prüft der Positionswächter */
  private armed = false;
  private okFor: DeckClip | null = null;
  /** Wer ein Element zuletzt angehalten hat (Diagnose, Issue 13): "app: wo". Fehlt der Eintrag beim pause-Ereignis, kam die Pause vom System. */
  private pauseBy = new WeakMap<DeckEl, string>();
  /** Ereignisse, die kamen, während die Seite im Hintergrund stand (Diagnose: laufen die Handler dort überhaupt) */
  private hiddenStats = { tu: 0, ended: 0, ends: 0, plays: 0, at: 0 };
  /** Letzter Wechsel im Hintergrund, bis das Element des Nachfolgers spielt (Diagnose) */
  private adv: { to: string; t0: number } | null = null;
  /** Ton und Wiedergabe des aktuellen Elements, getrieben von volumechange, playing und pause (Hinweis "Ton aus") */
  private snd: SoundObs = SOUND_NONE;
  /** Schlüssel aller Ausschnitte, die geladen wurden (Tests, Diagnose) */
  readonly history: string[] = [];
  /** Beim automatischen Weiter im Hintergrund: der Tausch auf das nächste bereite Element ist schon geschehen, jetzt die Buchführung */
  onAdvance: ((from: DeckClip, to: DeckClip) => void) | null = null;
  /** Vorrat (Kaltstart): liegt der Ausschnitt im Vorrat und fehlt nur die Blob-URL, ein Versprechen darauf (true = bereit). Sonst null. */
  pending: ((id: string, key: string) => Promise<boolean> | null) | null = null;
  /** Jeder Start einer Quelle: aus dem Vorrat oder vom Netz (Zähler coldNetStarts) */
  onStart: ((info: { clip: DeckClip; local: boolean }) => void) | null = null;
  /** Ein Netzstart wartet auf Daten (canplay steht aus): true, sobald er beginnt, false, wenn Daten da sind, ein Fehler kam oder die Quelle wechselte */
  onLoading: ((on: boolean) => void) | null = null;
  /** iOS setzt Now Playing beim Quellwechsel zurück: nach jedem playing und loadedmetadata des Elements meldet das Deck sich, der Host setzt Handler und Anzeige neu (Issue 35) */
  onMedia: ((ev: 'playing' | 'loadedmetadata') => void) | null = null;
  /** Letzter Stand, den setPositionState bekam (Tests, Diagnose) */
  lastPos: { duration: number; position: number; playbackRate: number } | null = null;
  /** Ausschnitt, der auf die Blob-URL aus dem Vorrat wartet */
  private holding: DeckClip | null = null;
  private holdToken = 0;
  private loadingOn = false;
  diag: (line: string) => void = () => {};

  /** Runde 27: Messpunkte je Element (Zeitpunkte von Sprung, play und Laden, ob ein Freischaltversuch lief, letzte endliche Dauer) für die Diag-Zeilen collapse und dur drop */
  private stat = new WeakMap<DeckEl, { seekAt: number; playAt: number; playN: number; seekN: number; loadAt: number; probed: boolean; dur: number }>();
  /** Runde 29: womit das Element freigeschaltet wurde (Diagnose): stille Inline-Quelle, ein echtes play() im Wisch oder Tipp, Probe auf einer Netzquelle */
  private unlockWho = new WeakMap<DeckEl, 'silent' | 'swipe' | 'probe'>();
  /** Runde 29: wartet mit dem ersten play() auf den Sprung (Element, Ausschnitt, Zeitgeber) */
  private jump: { el: DeckEl; key: string; id: string; t0: number; why: 'start' | 'swap'; timer: ReturnType<typeof setTimeout> } | null = null;
  private silentLast = '';
  /** Runde 29: Zähler der Ereignisse (erstes play, letzter Sprung) für playedBeforeSeek, unabhängig von der Uhr */
  private ev = 0;
  /** Runde 27: Ausweichen auf ein frisches Element: je Moment höchstens eins (Schlüssel, Zahl), das frische Element, solange es beobachtet wird */
  private dg = { key: '', n: 0 };
  private fresh: { el: DeckEl; key: string; id: string; from: number } | null = null;
  private envNoted = false;
  private lastCol: { el: DeckEl; at: number } | null = null;
  private allNoted = false;
  private t0 = Date.now();
  private unlockSilent: boolean;
  private neverMuted: boolean;
  /** Runde 30: "Ton aus" des Hosts (load, setMuted). Das Element selbst wird nie stumm geschaltet, bei Ton aus wartet der Ausschnitt auf den Tipp. */
  private soundOff = false;
  /** Runde 30: eine Geste, die iOS als Aktivierung zählt, hat es schon gegeben (unlock) */
  private gestSeen = false;
  /** Runde 30: der Vorrat darf laden (erste Geste hat alle Elemente still freigeschaltet) */
  private poolOpened = false;
  private waitTapKey = '';
  private mutedBlockNoted = false;
  private dodgeOn: boolean;

  constructor(private deps: DeckDeps) {
    this.unlockSilent = deps.unlockSilent ?? UNLOCK_SILENT;
    this.neverMuted = deps.neverMuted ?? NEVER_MUTED;
    this.dodgeOn = deps.dodge ?? true;
  }

  private st(el: DeckEl) {
    let r = this.stat.get(el);
    if (!r) {
      r = { seekAt: 0, playAt: 0, playN: 0, seekN: 0, loadAt: 0, probed: false, dur: Number.NaN };
      this.stat.set(el, r);
    }
    return r;
  }

  /** Runde 27: Quelle wurde gesetzt (neues Laden): Messpunkte des Elements neu */
  private markLoad(el: DeckEl) {
    const r = this.st(el);
    r.loadAt = Date.now();
    r.seekAt = 0;
    r.playAt = 0;
    r.playN = 0;
    r.seekN = 0;
    r.probed = false;
    r.dur = Number.NaN;
  }

  /** Runde 27: eine Zeile je Sitzung: Gerät und Betriebssystem, ob als App auf dem Home-Bildschirm (standalone) */
  private noteEnv() {
    if (this.envNoted) return;
    this.envNoted = true;
    try {
      const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { standalone?: boolean }) : undefined;
      const ua = nav?.userAgent ?? 'none';
      const m = /OS (\d+)[_.](\d+)/.exec(ua);
      const short = m ? `${/iPad/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : 'iOS'} iOS ${m[1]}.${m[2]}` : ua.slice(0, 60);
      const sa = nav?.standalone === true || (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
      this.diag(`env: ua=${short} standalone=${sa ? 1 : 0}`);
    } catch {
      this.diag('env: ua=unknown standalone=0');
    }
  }

  /** Runde 27: Kennung des Moments, der in diesem Element steckt (für die Diag-Zeilen) */
  private idOf(el: DeckEl): string {
    return this.entryOf(el)?.clip.id ?? this.keptOf(el)?.clip.id ?? (el === this.el ? this.clip?.id : undefined) ?? 'spare';
  }

  private ranges(b: BufRanges | null | undefined): string {
    try {
      if (!b || !(b.length > 0)) return '[]';
      const out: string[] = [];
      for (let i = 0; i < Math.min(3, b.length); i++) out.push(`${(b.start ? b.start(i) : 0).toFixed(1)}-${b.end(i).toFixed(1)}`);
      return `[${out.join(',')}]`;
    } catch {
      return '[]';
    }
  }

  private since(at: number): string {
    return at > 0 ? String(Date.now() - at) : 'none';
  }

  private num(n: number): string {
    return Number.isFinite(n) ? n.toFixed(1) : String(n);
  }

  /** Runde 27: Zeile "deck: collapse": Stand des Elements beim Kollaps der Dauer */
  private collapseLine(el: DeckEl, id: string) {
    const r = this.st(el);
    const loading = this.all().filter((e) => !!e.src && !e.src.startsWith('data:') && (e.networkState ?? (e.readyState < 4 ? 2 : 1)) === 2).length;
    this.diag(
      `deck: collapse ${id} dur=${this.num(el.duration)} t=${this.num(el.currentTime)} rs=${el.readyState} ns=${el.networkState ?? 'n/a'} err=${el.error?.code ?? 'none'} seeking=${el.seeking ? 1 : 0} buf=${this.ranges(el.buffered)} seekable=${this.ranges(el.seekable)} played=${this.ranges((el as unknown as { played?: BufRanges }).played)} sinceSeek=${this.since(r.seekAt)} sincePlay=${this.since(r.playAt)} sinceLoad=${this.since(r.loadAt)} unlocked=${this.unlockedEls.has(el) ? 1 : 0} unlockedBy=${this.unlockedEls.has(el) ? (this.unlockWho.get(el) ?? 'swipe') : 'none'} playedBeforeSeek=${r.playN > 0 && r.playN < r.seekN ? 1 : 0} muted=${el.muted ? 1 : 0} probed=${r.probed ? 1 : 0} loading=${loading}`,
    );
  }

  /** Das Element, angelegt beim ersten Gebrauch. Es wird nie ersetzt. */
  get element(): DeckEl {
    if (!this.el) this.el = this.ensure('plain');
    return this.el;
  }

  /** Element der Spur: das aktive, wenn es zu ihr gehört, sonst ein freies (weder aktiv noch im Vorrat), bei Bedarf neu angelegt */
  private ensure(lane: Lane): DeckEl {
    if (this.el && this.laneOf.get(this.el) === lane) return this.el;
    return this.spare(lane);
  }

  private spare(lane: Lane): DeckEl {
    return this.preferUnlocked(this.pool[lane].filter((e) => e !== this.el && !this.entryOf(e) && !this.keptOf(e))) ?? this.makeEl(lane);
  }

  /** Runde 29: aus freien Elementen zuerst ein freigeschaltetes */
  private preferUnlocked(list: DeckEl[]): DeckEl | undefined {
    return list.find((e) => this.unlockedEls.has(e)) ?? list[0];
  }

  private keptOf(el: DeckEl): PoolEntry | undefined {
    return this.kept.find((k) => k.el === el);
  }

  /** Runde 26: Stand des aktiven Elements als Eintrag, falls es sich zum Behalten eignet (Daten da, kein Fehler, keine Stille-Quelle) */
  private snapActive(): PoolEntry | null {
    const el = this.el;
    const c = this.clip;
    if (!el || !c || this.holding || !el.src || el.src.startsWith('data:') || el.error || el.readyState < 1) return null;
    return {
      clip: c,
      el,
      lane: this.lane,
      why: this.loudInfo.how.replace(/^unchanged: /, ''),
      chain: this.loudLinear ? { linear: this.loudLinear } : null,
      local: this.isLocal,
      offset: this.offset,
      target: Math.max(0, c.start - this.offset),
      meta: true,
      cpt: true,
      ready: true,
      rsAtReady: el.readyState,
      thin: false,
      t0: Date.now(),
    };
  }

  /** Runde 26: der verlassene Moment bleibt geladen. Ältere gehen über KEEP_PREV hinaus frei, und der Vorrat gibt seinen am weitesten vorausliegenden Eintrag ab, bis alles in POOL + 1 Elemente passt. */
  private addKept(p: PoolEntry) {
    for (const k of this.kept.filter((x) => x.clip.key === p.clip.key)) this.releaseKept(k);
    this.kept.push(p);
    while (this.kept.length > KEEP_PREV) this.releaseKept(this.kept[0]);
    while (this.entries.length > POOL - this.kept.length) {
      const far = this.entries[this.entries.length - 1];
      this.dropEntry(far, 'room for kept');
    }
    this.diag(`deck: keep prev ${p.clip.id} (kept ${this.kept.length})`);
  }

  private releaseKept(k: PoolEntry) {
    this.kept = this.kept.filter((x) => x !== k);
    if (!this.hidden()) this.clearSrc(k.el);
  }

  /** Runde 26: ein freies Element der Spur (weder aktiv noch Vorrat noch behalten), nötigenfalls vom Vorrat abgezweigt. null, wenn keins zu haben ist. */
  private freeEl(lane: Lane): DeckEl | null {
    const find = () => this.preferUnlocked(this.pool[lane].filter((e) => e !== this.el && !this.entryOf(e) && !this.keptOf(e))) ?? null;
    let el = find();
    if (!el && this.pool[lane].length < POOL + 1) {
      const made = this.makeEl(lane);
      if (made !== this.el && !this.entryOf(made) && !this.keptOf(made)) el = made;
    }
    if (!el) {
      const far = [...this.entries].reverse().find((e) => e.lane === lane);
      if (far) {
        this.dropEntry(far, 'room for kept');
        el = find();
      }
    }
    return el;
  }

  private makeEl(lane: Lane): DeckEl {
    const el = (this.deps.make ?? defaultMake)(lane === 'level');
    // Ein Nachbau, der immer dasselbe Element liefert (Tests), wird nicht doppelt eingetragen und verdrahtet
    if (!this.laneOf.has(el)) {
      this.pool[lane].push(el);
      this.laneOf.set(el, lane);
      this.wire(el);
    }
    return el;
  }

  /** Mindestens n Elemente der Spur anlegen (für die Freischaltung per Geste) */
  private ensureCount(lane: Lane, n: number) {
    while (this.pool[lane].length < n) {
      const before = this.pool[lane].length;
      this.makeEl(lane);
      if (this.pool[lane].length === before) break;
    }
  }

  private all(): DeckEl[] {
    return [...this.pool.plain, ...this.pool.level];
  }

  get exists(): boolean {
    return !!this.el;
  }

  private hidden = () => (this.deps.hidden ?? defaultHidden)();

  /** Diagnosezeile "bg: deck ...": beantwortet im Protokoll, was im Hintergrund mit dem Element geschieht (Issue 13) */
  private note(line: string) {
    this.diag(`bg: deck ${line}`);
  }

  private loading(on: boolean) {
    if (this.loadingOn === on) return;
    this.loadingOn = on;
    this.onLoading?.(on);
  }

  /** Media Session: Länge und Stelle des Moments (nicht der Folge), damit der Sperrbildschirm den Fortschritt des Moments zeigt */
  private position(el: DeckEl) {
    const c = this.clip;
    if (!c || this.done) return;
    const raw = c.end !== undefined ? c.end - c.start : (el.duration || 0) + this.offset - c.start;
    const duration = Number.isFinite(raw) && raw > 0 ? raw : 0;
    if (!duration) return;
    const position = Math.min(duration, Math.max(0, el.currentTime + this.offset - c.start));
    const playbackRate = el.playbackRate > 0 ? el.playbackRate : 1;
    this.lastPos = { duration, position, playbackRate };
    try {
      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator && navigator.mediaSession.setPositionState) navigator.mediaSession.setPositionState(this.lastPos);
    } catch {
      /* Wert vom System abgelehnt */
    }
  }

  /** Element anhalten und merken, wer es war: kommt das pause-Ereignis ohne diesen Eintrag, hat das System pausiert */
  private halt(el: DeckEl, by: string) {
    if (!el.paused) this.pauseBy.set(el, by);
    el.pause();
  }

  /** Runde 20: liegt hinter der Position des Elements Puffer (mehr als AHEAD_MIN_S)? Ohne Bereiche auf dem Gerät: ja (kein Maßstab). */
  private aheadOk(el: DeckEl): boolean {
    const end = bufferedEnd(el.buffered, el.currentTime);
    if (end === undefined) return true;
    return end !== null && end > el.currentTime + AHEAD_MIN_S;
  }

  /** Runde 20: Wächter nach Tausch oder Neustart: true, solange noch kein Puffer hinter der Position liegt. Sobald er da ist, endet der Wächter. */
  private starved(el: DeckEl): boolean {
    if (this.guard !== el) return false;
    if (this.aheadOk(el)) {
      this.guard = null;
      return false;
    }
    return true;
  }

  /** Runde 20: Text für die Zeilen "pool not ready yet" und "swap onto thin buffer": Puffer-Ende an der Stelle oder none */
  private bufText(el: DeckEl, t: number): string {
    const end = bufferedEnd(el.buffered, t);
    return typeof end === 'number' ? end.toFixed(1) : 'none';
  }

  /** Runde 20: Lade-Zustand melden (wie waiting), ohne Neuaufbau */
  private showLoading() {
    this.live = false;
    this.samp = null;
    this.sink?.state(BUFFERING);
    this.loading(true);
  }

  /** Das Element spielt (Ereignis playing, oder aus fortschreitender Position abgeleitet, Runde 17) */
  private playingNow(el: DeckEl) {
    const mine = () => el === this.el;
    if (this.adv && this.adv.to === this.clip?.id) {
      this.note(`advance to ${this.adv.to}: playing after ${Date.now() - this.adv.t0} ms, rate ${el.playbackRate}, ${this.stateText(el)}`);
      this.adv = null;
    }
    // Runde 18: brauchte der Ausschnitt vom Start bis zum ersten playing mehr als WEAK_PLAY_MS (ohne Warten auf einen Tipp, nur Netz), ist das Netz schwach
    const c0 = this.clip;
    if (!this.played && c0 && !this.isLocal && this.clipAt > 0 && this.refusedKey !== c0.key) {
      const took = Date.now() - this.clipAt;
      if (took > WEAK_PLAY_MS) this.markWeak();
      else if (this.coldNet) this.noteFast(took, WEAK_OK_START_MS, 'net start');
    }
    // Runde 20: nach Tausch oder Neustart ohne Daten hinter der Position ist "playing" des Elements kein Ton. Laden anzeigen, bis die Zeit läuft (inferPlaying leitet es zurück).
    const starved = this.starved(el);
    this.live = !starved;
    this.played = true;
    // Runde 12: der aktive Moment spielt, zurückgestellte Vorlade-Abrufe starten jetzt (bis POOL)
    if (this.deferNoted && !starved) this.refillDeferred();
    this.onMedia?.('playing');
    this.loading(starved);
    this.snd = reduceSound(this.snd, 'playing', this.soundView(el));
    this.sink?.state(starved ? BUFFERING : PLAYING);
    this.sink?.sound?.();
    this.tick(el);
    // Web Audio läuft nicht (iOS hat den Kontext unterbrochen): die geregelte Spur wäre stumm, darum zurück auf die unveränderte
    if (this.lane === 'level' && this.deps.running) {
      window.setTimeout(() => {
        if (mine() && this.lane === 'level' && !el.paused && !this.done && !this.deps.running?.()) {
          this.deps.broken?.('context not running');
          this.bail('context not running');
        }
      }, 700);
    }
  }

  private wire(el: DeckEl) {
    // Ereignisse des gerade nicht benutzten Elements zählen nicht, die eines Vorrats-Elements gehen nur an seine Bereitschaft (eine Verdrahtung je Element, nie doppelt)
    const mine = () => el === this.el;
    const entry = () => this.entryOf(el);
    el.addEventListener('playing', () => {
      if (mine()) {
        this.checkPosHold();
        this.playingNow(el);
      }
    });
    el.addEventListener('waiting', () => {
      if (!mine()) return;
      this.live = false;
      this.samp = null;
      this.sink?.state(BUFFERING);
      this.tick(el);
    });
    // Runde 18: Daten kommen an (Zähler für den Hänge-Wächter des Feeds, siehe bytes)
    el.addEventListener('progress', () => {
      if (mine()) {
        this.prog++;
        this.pollData();
      }
      // Runde 20: neue Daten können einen Vorrats-Eintrag mit dünnem Puffer bereit machen
      const e = entry();
      if (e && !e.ready) this.checkEntry(e);
    });
    el.addEventListener('seeking', () => {
      const r = this.st(el);
      r.seekAt = Date.now();
      r.seekN = ++this.ev;
    });
    el.addEventListener('play', () => {
      const r = this.st(el);
      r.playAt = Date.now();
      if (!r.playN) r.playN = ++this.ev;
    });
    el.addEventListener('durationchange', () => {
      const e = entry();
      const key = e?.clip.key ?? (mine() ? this.clip?.key : undefined);
      // Runde 27: fällt die Dauer eines Elements um mehr als REAL_END_GAP, eine Zeile mit dem Stand (ersetzt "duration dropped" aus Runde 25)
      const r = this.st(el);
      const d = el.duration;
      if (Number.isFinite(d) && Number.isFinite(r.dur) && d < r.dur - REAL_END_GAP) {
        this.diag(
          `deck: dur drop ${this.idOf(el)} ${this.num(r.dur)} -> ${this.num(d)} t=${this.num(el.currentTime)} rs=${el.readyState} paused=${el.paused ? 1 : 0} seeking=${el.seeking ? 1 : 0} sinceSeek=${this.since(r.seekAt)} sincePlay=${this.since(r.playAt)} probed=${r.probed ? 1 : 0}`,
        );
      }
      r.dur = Number.isFinite(d) ? d : Number.NaN;
      if (key !== undefined) this.noteDur(el, key);
      if (e && !e.ready) this.checkEntry(e);
      if (mine()) this.pollData();
    });
    el.addEventListener('pause', () => {
      const by = this.pauseBy.get(el);
      this.pauseBy.delete(el);
      if (mine()) this.note(`pause event by=${by ?? (el.ended ? 'media end' : 'system')} hidden=${this.hidden()} done=${this.done} ${this.stateText(el)}`);
      if (!mine()) return;
      this.samp = null;
      this.snd = reduceSound(this.snd, 'pause', this.soundView(el));
      this.sink?.sound?.();
      this.tick(el);
      // Ein Pause-Ereignis, das einem Quellwechsel vorausging, ist veraltet: das Element spielt schon wieder
      if (!el.paused || this.done) return;
      // Am Ende der Quelle kommt pause vor ended. Das ist kein Anhalten: sonst meldet die App Pause, die Media Session steht auf paused,
      // und der Sperrbildschirm zeigt Pause, während der Ende-Handler gleich den nächsten Moment startet.
      if (el.ended) {
        // Runde 13: kam das Ende, ohne dass der Ausschnitt je spielte, ist es vorzeitig (iOS, stummer Start): neu starten
        if (!this.played) this.earlyEnded(el);
        return;
      }
      this.live = false;
      this.sink?.state(PAUSED);
    });
    el.addEventListener('volumechange', () => {
      if (!mine()) return;
      // Runde 24: entstummt der Host das Element, während die Position noch nicht bestätigt ist (ytApi.unMute schreibt auf alle Elemente), gilt das als Wunsch für die Zeit danach
      if (this.posHold?.el === el && !el.muted) {
        this.posHold.real = false;
        el.muted = true;
      }
      this.snd = reduceSound(this.snd, 'volumechange', this.soundView(el));
      this.sink?.sound?.();
    });
    // Ein ended ohne vorheriges playing dieses Ausschnitts stammt vom vorigen Inhalt (zum Beispiel der Stille der Freischaltung) und zählt nicht
    el.addEventListener('ended', () => {
      if (mine() && this.hidden()) this.hiddenStats.ended++;
      if (mine()) this.note(`ended event played=${this.played} hidden=${this.hidden()} ${this.stateText(el)}`);
      // Runde 17: ein ended zählt nur, wenn es plausibel ist (Ende des Ausschnitts oder der Quelle), sonst Wiederherstellung statt Weiter
      if (mine() && this.played) this.endedCheck(el, 'ended');
      // Runde 25: auch vor dem ersten playing: ein Ende vor der echten Dauer wartet auf Daten, kein Neustart
      else if (mine() && !(this.clip && this.tryWait(el, this.clip))) this.earlyEnded(el);
    });
    el.addEventListener('timeupdate', () => {
      if (mine()) this.checkPosHold();
      if (mine()) this.pollData();
      if (mine() && this.guardPos(el)) return;
      if (mine()) this.tick(el);
      if (mine() && this.fresh) this.freshOk(el);
      const c = this.clip;
      if (mine() && this.hidden()) this.hiddenStats.tu++;
      // Runde 17: "playing" blieb aus, die Position schreitet aber fort: als laufend ableiten
      if (mine()) this.inferPlaying(el);
      if (!mine() || !c || c.end === undefined || el.paused) return;
      if (el.currentTime >= c.end - this.offset - END_EPS) this.clipEnd('timeupdate');
    });
    el.addEventListener('loadedmetadata', () => {
      const e = entry();
      const key = e?.clip.key ?? (mine() ? this.clip?.key : undefined);
      if (key !== undefined) this.noteDur(el, key);
      if (e) {
        e.meta = true;
        this.checkEntry(e);
        return;
      }
      if (!mine()) return;
      this.diag(`deck loadedmetadata ${this.stateText(el)}`);
      // Die Quelle lud in der geregelten Spur: der Host erlaubt CORS. Lud sie erst nach einem Fehler dort unverändert: er erlaubt es nicht.
      const c = this.clip;
      if (c && !this.isLocal) {
        if (this.lane === 'level') this.deps.host?.(c.url, 'ok');
        else if (this.trialFailed === c.url) this.deps.host?.(c.url, 'bad');
      }
      this.trialFailed = null;
      this.seek(true);
      this.armed = true;
      this.posSetLine(el);
      this.checkPosHold();
      this.onMedia?.('loadedmetadata');
      // Runde 29: der Sprung ist gesetzt, jetzt wartet der erste play() auf seeked (höchstens JUMP_WAIT_MS)
      if (this.jump?.el === el) {
        clearTimeout(this.jump.timer);
        this.jump.timer = setTimeout(() => this.releaseJump('timeout'), JUMP_WAIT_MS);
        this.jumpCheck(el, 'position');
      }
    });
    // Zweiter Anstoß, wenn Daten da sind und das erste play() nichts bewirkt hat (iOS verwirft play() vor den Metadaten manchmal still)
    el.addEventListener('canplaythrough', () => {
      const e = entry();
      if (!e) return;
      e.cpt = true;
      this.checkEntry(e);
    });
    el.addEventListener('seeked', () => {
      if (mine()) {
        this.samp = null;
        this.checkPosHold();
        this.pollData();
        this.jumpCheck(el, 'seeked');
      }
      const e = entry();
      if (e) this.checkEntry(e);
    });
    el.addEventListener('canplay', () => {
      const e = entry();
      if (e) this.checkEntry(e);
      if (mine()) this.pollData();
      if (mine()) this.jumpCheck(el, 'canplay');
      // Runde 25: während des Wartens auf Daten kein Ladeende und kein Anstoß von hier, das Warten entscheidet
      if (mine() && !this.dataWait) this.loading(false);
      if (mine() && !this.dataWait && !this.jump && this.clip && this.want && el.paused && !this.done && !this.nudged && this.refusedKey !== this.clip.key) {
        this.nudged = true;
        this.kick('canplay');
      }
    });
    el.addEventListener('error', () => {
      const e = entry();
      if (e) {
        this.entryError(e);
        return;
      }
      const c = this.clip;
      if (!mine() || !c || this.done) return;
      this.loading(false);
      if (this.isLocal) {
        // Ausschnitt aus dem Vorrat nicht abspielbar: einmal vom Netz laden statt zu überspringen
        this.deps.dropLocal(c.key);
        this.diag(`deck local failed ${c.id}, reload from net`);
        this.start(c, this.want, false, this.resumeFrom);
        return;
      }
      // Geregelte Spur, Quelle aus dem Netz: meist fehlt die CORS-Freigabe. Dieser Ausschnitt läuft unverändert weiter, nie ein Überspringen.
      if (this.lane === 'level') {
        this.trialFailed = c.url;
        this.diag(`loud: level lane failed (code ${el.error?.code ?? '?'}), playing unchanged`);
        this.start(c, this.want, true, this.resumeFrom, 'skipped cors');
        return;
      }
      this.diag(`deck error ${c.id}`);
      this.sink?.error();
    });
  }

  /** Runde 17: neuer Ausschnitt (oder neue Quelle desselben): Proben und Messung neu. Die Wiederherstellungen zählen je Ausschnitt, ein Neuaufbau selbst setzt sie nicht zurück. */
  private noteClip(key: string, fresh = false) {
    this.endWait();
    this.endJump();
    this.guard = null;
    this.samp = null;
    this.froz = null;
    this.okFor = null;
    if (!this.rebuilding) {
      this.clipAt = Date.now();
      this.prog = 0;
    }
    if (!this.rebuilding && (fresh || this.posFix.key !== key)) this.posFix = { key, n: 0 };
    if (!this.rebuilding && (fresh || this.recov.key !== key)) this.recov = { key, n: 0, at: 0, pending: false, gaveUp: false };
    if (!this.rebuilding && (fresh || this.fe.key !== key)) this.fe = { key, times: [], rebuilt: false, dead: false };
    if (!this.rebuilding && (fresh || this.dw.key !== key)) this.dw = { key, n: 0, timedOut: false };
    if (!this.rebuilding && (fresh || this.dg.key !== key)) this.dg = { key, n: 0 };
    if (!this.rebuilding) this.fresh = null;
    this.posLineKey = '';
  }

  // ---- Runde 24: Position ohne Medienfragment, stumm bis bestätigt ----

  /** Ton-Zustand, den Host und Entsperrung wollen: während der Stummhaltung der gemerkte, sonst der des Elements */
  private realMuted(el: DeckEl): boolean {
    return this.posHold?.el === el ? this.posHold.real : el.muted;
  }

  /** Das Element für Hinweis "Ton aus": die Stummhaltung bis zur Bestätigung zählt nicht */
  private soundView(el: DeckEl) {
    return { muted: this.neverMuted ? this.soundOff : this.realMuted(el), volume: el.volume, paused: el.paused };
  }

  /** Ton setzen (Host: load, setMuted). Während der Stummhaltung nur merken, gilt ab Bestätigung. */
  private applyMuted(el: DeckEl, m: boolean) {
    // Runde 30: nie ein Element stumm schalten. "Ton aus" des Hosts ist ein Wunsch, der Ausschnitt wartet dann pausiert auf den Tipp (kick).
    if (this.neverMuted) {
      this.soundOff = m;
      if (el.muted) el.muted = false;
      return;
    }
    if (this.posHold?.el === el) {
      this.posHold.real = m;
      this.snd = reduceSound(this.snd, 'volumechange', this.soundView(el));
      this.sink?.sound?.();
      return;
    }
    el.muted = m;
  }

  /**
   * Netzquellen tragen kein Medienfragment (#t=) mehr: iOS meldete damit duration gleich Startstelle und dann ended. Die Position setzt currentTime nach loadedmetadata.
   * Damit vom Folgenanfang nie Ton zu hören ist, bleibt das Element stumm, bis currentTime an der Startstelle steht (höchstens POS_CONFIRM_MS, dann ein letzter Sprung).
   * Nicht für lokale Quellen (nie ein Fragment) und nicht verdeckt (iOS verweigert dort das Entstummen ohne Geste vermutlich: lieber Ton als Stille).
   */
  private beginPosHold(el: DeckEl, c: DeckClip) {
    this.releaseHold();
    // Runde 30: keine Stummhaltung. Ohne play() vor dem Sprung (Runde 29) hört niemand den Folgenanfang, und stumm gespielt wird nie.
    if (this.neverMuted || this.isLocal || this.target <= 0 || this.hidden()) return;
    const key = c.key;
    // Steht die Position schon (Eintrag des Vorrats an der Startstelle): nicht stumm schalten, kein Ton geht verloren
    if (positionConfirmed({ t: el.currentTime, target: this.target, rs: el.readyState, seeking: !!el.seeking })) {
      this.posSetLine(el);
      this.diag(`deck: pos confirmed ${c.id} t=${el.currentTime.toFixed(1)} after 0 ms, unmute`);
      return;
    }
    const tick = setInterval(() => this.checkPosHold(), 100);
    const stop = setTimeout(() => this.posTimeout(), POS_CONFIRM_MS);
    this.posHold = { el, key, id: c.id, target: this.target, real: el.muted, t0: Date.now(), tick, stop };
    el.muted = true;
  }

  /** Zeile "pos set", einmal je Ausschnitt, sobald die Position wirklich gesetzt ist (Metadaten da). Nur Netzquellen (lokale hatten nie ein Fragment). */
  private posSetLine(el: DeckEl) {
    const c = this.clip;
    if (!c || el !== this.el || this.isLocal || this.posLineKey === c.key) return;
    this.posLineKey = c.key;
    const d = Number.isFinite(el.duration) ? el.duration.toFixed(1) : String(el.duration);
    this.diag(`deck: pos set ${c.id} target=${this.target.toFixed(1)} dur=${d} t=${el.currentTime.toFixed(1)} frag=none`);
  }

  private checkPosHold() {
    const h = this.posHold;
    if (!h) return;
    const el = h.el;
    if (el !== this.el || this.clip?.key !== h.key || this.done) {
      this.releaseHold();
      return;
    }
    // Runde 25: wartet das Element auf Daten, hält das Warten die Stummhaltung
    if (this.dataWait?.el === el) return;
    if (!positionConfirmed({ t: el.currentTime, target: h.target, rs: el.readyState, seeking: !!el.seeking })) return;
    this.diag(`deck: pos confirmed ${h.id} t=${el.currentTime.toFixed(1)} after ${Date.now() - h.t0} ms, unmute`);
    this.releaseHold();
  }

  private posTimeout() {
    const h = this.posHold;
    if (!h) return;
    const el = h.el;
    if (this.dataWait?.el === el) return;
    if (el === this.el && this.clip?.key === h.key && !this.done) {
      this.diag(`deck: pos unconfirmed ${h.id} t=${el.currentTime.toFixed(1)} target=${h.target.toFixed(1)} after ${POS_CONFIRM_MS} ms`);
      try {
        el.currentTime = h.target;
      } catch {
        /* iOS lehnt die Position ab */
      }
    }
    this.releaseHold();
  }

  /** Stummhaltung beenden: Ton wie gemerkt (Host-Wunsch), Zeitgeber weg */
  private releaseHold() {
    const h = this.posHold;
    if (!h) return;
    clearInterval(h.tick);
    clearTimeout(h.stop);
    this.posHold = null;
    try {
      if (h.el.muted !== h.real) h.el.muted = h.real;
    } catch {
      /* Element weg */
    }
  }

  /** Runde 17: das Ereignis playing blieb aus, das Element ist nicht pausiert und seine Position wächst über mindestens zwei Proben um mehr als ADVANCE_MIN */
  private inferPlaying(el: DeckEl) {
    const c = this.clip;
    if (!c || this.done || this.live || el.paused || el.readyState < 3 || this.holding) return;
    this.samp = sampleTime(this.samp, el.currentTime);
    if (!timeAdvancing(this.samp)) return;
    this.samp = null;
    this.diag(`deck: playing inferred (time advancing) ${c.id}`);
    this.playingNow(el);
  }

  /** Runde 17: ended (Ereignis oder el.ended): Ende nur, wenn plausibel, sonst falsches Ende mit Wiederherstellung */
  private endedCheck(el: DeckEl, via: 'ended' | 'poll') {
    const c = this.clip;
    if (!c || this.done) return;
    // Runde 22: ein ended vor dem Schnittbeginn ist der Sprung auf 0: sofort zurück an die Stelle
    if (this.guardPos(el)) return;
    // Runde 25: läuft schon ein Warten auf Daten, zählt dieses ended nicht (die Abfrage und das ended-Ereignis kommen weiter)
    if (this.dataWait?.el === el && this.dataWait.key === c.key) return;
    const t = el.currentTime;
    const dur = el.duration;
    // Runde 18: Sekunden, die der Ausschnitt in diesem Element seit Start oder letztem Neuaufbau gelaufen ist (target ist die Startstelle der Elementzeit)
    const advanced = Number.isFinite(t) ? Math.max(0, t - this.target) : 0;
    // Runde 25: erst das Ende des Ausschnitts (dort ist es immer ein Ende), dann das Warten auf Daten, dann die Dauer-Regel
    if (plausibleEnd({ t, dur: Number.NaN, clipEnd: c.end, offset: this.offset, advanced })) {
      this.clipEnd(via);
      return;
    }
    if (this.tryWait(el, c)) return;
    // Runde 27: Dauer gleich Position, Daten dahinter: nicht dasselbe Element neu aufbauen, ein frisches nehmen
    const col = this.dodgeCollapse(el, c);
    if (col === 'dodged') return;
    if (plausibleEnd({ t, dur, clipEnd: c.end, offset: this.offset, advanced })) {
      this.clipEnd(via);
      return;
    }
    // Runde 21: zweites ended kurz nach der Wiederherstellung oder mit leerer Dauer an der Startstelle: ignorieren (Abfrage still, Ereignis mit Diag-Zeile)
    const skip = ignoreEnded({ sinceRecoverMs: this.recov.at ? Date.now() - this.recov.at : Number.POSITIVE_INFINITY, t, dur, target: this.target });
    if (skip) {
      if (via === 'ended') this.diag(`deck: ended ignored ${c.id} (${skip})`);
      return;
    }
    // Die Abfrage wartet nach einer Wiederherstellung, bevor sie dasselbe ended noch einmal wertet
    if (via === 'poll' && Date.now() - this.recov.at < 600) return;
    // Runde 24: gestört gemeldet oder aufgegeben: still (früher 50 gleiche Zeilen in 10 s)
    if (this.fe.dead) return;
    const gate = falseEndedGate({ times: this.fe.times, now: Date.now(), rebuilt: this.fe.rebuilt });
    this.fe.times = gate.times;
    if (gate.step === 'rebuild') {
      this.fe.rebuilt = true;
      if (col !== 'logged') this.collapseLine(el, c.id);
      this.diag(`deck: false ended loop ${c.id} (more than ${FALSE_ENDED_MAX} in ${FALSE_ENDED_WINDOW_MS / 1000} s), rebuilding source`);
      this.rebuildSource(c, Number.isFinite(t) && t > this.target ? t : this.target);
      return;
    }
    if (gate.step === 'broken') {
      this.fe.dead = true;
      this.recov.gaveUp = true;
      if (col !== 'logged') this.collapseLine(el, c.id);
      this.diag(`deck: moment broken ${c.id} (false ended loop after rebuild), skipping`);
      this.loading(false);
      if (this.sink?.broken) this.sink.broken();
      else this.sink?.error();
      return;
    }
    // Nach dem Aufgeben des weichen Wegs zählen weitere falsche Enden weiter (Schleife), melden aber nichts, bis die nächste Stufe greift
    if (this.recov.gaveUp) return;
    if (col !== 'logged') this.collapseLine(el, c.id);
    this.diag(`deck: false ended ${c.id} t=${t.toFixed(1)} dur=${Number.isFinite(dur) ? dur.toFixed(1) : String(dur)} adv=${advanced.toFixed(1)}, recovering`);
    this.recover(el, 'ended', t);
  }

  // ---- Runde 27: Kollaps der Dauer, Ausweichen auf ein frisches Element ----

  /**
   * Kollaps: iOS meldet duration gleich Position (Ende), obwohl die Datei weiter reicht. Die bekannte echte Dauer (auch von früheren Elementen desselben Moments)
   * oder das Puffer-Ende liegt mehr als REAL_END_GAP hinter der Position. Eine Position unter 0,5 s ist der leere Fall (ignoreEnded), kein Kollaps.
   */
  private collapsed(el: DeckEl, c: DeckClip): boolean {
    const t = el.currentTime;
    const d = el.duration;
    if (!Number.isFinite(t) || !Number.isFinite(d) || t < 0.5 || d > t + 0.5) return false;
    this.noteDur(el, c.key);
    let end = this.realDur.get(c.key) ?? 0;
    const be = bufferedEnd(el.buffered, t);
    if (typeof be === 'number') end = Math.max(end, be);
    return end > t + REAL_END_GAP;
  }

  /**
   * Beim Ende des aktiven Elements: ist es ein Kollaps und darf ausgewichen werden? 'dodged': auf ein frisches Element gewechselt, der Aufrufer tut nichts mehr.
   * 'logged': Kollaps, Zeile steht, es geht in die bestehende Kette (zweiter Kollaps, schon einmal ausgewichen, verdeckt, lokal, kein freies Element).
   * 'none': kein Kollaps (oder nicht zuständig), nichts geschrieben.
   */
  private dodgeCollapse(el: DeckEl, c: DeckClip): 'dodged' | 'logged' | 'none' {
    if (el !== this.el || this.clip !== c || this.done || this.holding || !this.want || this.isLocal) return 'none';
    if (!this.collapsed(el, c)) return 'none';
    // pause und ended desselben Kollapses kommen kurz nacheinander: eine Zeile
    if (this.lastCol && this.lastCol.el === el && Date.now() - this.lastCol.at < 500) return 'logged';
    this.lastCol = { el, at: Date.now() };
    this.collapseLine(el, c.id);
    // Ein zweiter Kollaps auf dem frischen Element: die bestehende Kette
    if (this.fresh && this.fresh.el === el && this.fresh.key === c.key) {
      this.diag(`deck: fresh element ${c.id} collapsed`);
      this.fresh = null;
      return 'logged';
    }
    // Verdeckt lädt iOS nichts nach, ein load() hängt das Element: kein Ausweichen
    if (!this.dodgeOn || this.hidden() || (this.dg.key === c.key && this.dg.n >= 1)) return 'logged';
    return this.dodge(el, c) ? 'dodged' : 'logged';
  }

  /** Ein freies Element der Spur für das Ausweichen. Freigeschaltete zuerst, nötigenfalls gibt der am weitesten vorausliegende Eintrag seinen Platz ab (nie der nächste, nie der behaltene). */
  private freshEl(lane: Lane, old: DeckEl): DeckEl | null {
    const free = this.pool[lane].filter((e) => e !== old && e !== this.el && !this.entryOf(e) && !this.keptOf(e));
    const far = this.entries.filter((e, i) => i > 0 && e.lane === lane).reverse();
    const take = (e: PoolEntry): DeckEl => {
      this.dropEntry(e, 'room for fresh');
      this.depleted = true;
      return e.el;
    };
    const freeU = free.find((e) => this.unlockedEls.has(e));
    if (freeU) return freeU;
    const farU = far.find((e) => this.unlockedEls.has(e.el));
    if (farU) return take(farU);
    if (free[0]) return free[0];
    if (this.pool[lane].length < POOL + 1) {
      const made = this.makeEl(lane);
      if (made !== old && made !== this.el && !this.entryOf(made) && !this.keptOf(made)) return made;
    }
    return far[0] ? take(far[0]) : null;
  }

  /**
   * Dieselbe Adresse in ein anderes Element laden, Ziel DODGE_BACK früher, spielen. Das alte Element gibt seine Quelle frei. Höchstens einmal je Moment (dg).
   * Beim Wechsel zählen die Wiederherstellungs-Zähler weiter (rebuilding), danach greift bei erneutem Kollaps die bestehende Kette.
   */
  private dodge(old: DeckEl, c: DeckClip): boolean {
    const fresh = this.freshEl(this.lane, old);
    if (!fresh) return false;
    let chain: { linear: () => number } | null = null;
    if (this.lane === 'level') {
      chain = this.deps.chain?.(fresh, c.gain ?? 0) ?? null;
      if (!chain) return false;
    }
    const at = Math.max(this.target, old.currentTime);
    const target = Math.max(0, at - DODGE_BACK);
    this.dg = { key: c.key, n: this.dg.key === c.key ? this.dg.n + 1 : 1 };
    const muted = this.realMuted(old);
    this.rebuilding = true;
    try {
      this.noteClip(c.key);
    } finally {
      this.rebuilding = false;
    }
    this.releaseHold();
    this.halt(old, 'app: dodge to fresh element');
    this.clearSrc(old);
    if (!this.neverMuted) fresh.muted = muted;
    this.el = fresh;
    if (this.lane === 'level') this.loudLinear = chain ? chain.linear : null;
    this.armed = false;
    this.live = false;
    this.played = false;
    this.nudged = false;
    this.resetEarly();
    this.inflightAt = 0;
    this.kickTok++;
    this.skipNoted = false;
    this.needTapKey = '';
    this.target = target;
    this.resumeFrom = target + this.offset;
    this.snd = { muted: isSilent(this.soundView(fresh)), playing: false, refused: false };
    this.sink?.time?.(target + this.offset, fresh.playbackRate || 1, false);
    this.markLoad(fresh);
    fresh.src = c.url;
    fresh.load();
    this.loading(fresh.readyState < 3);
    this.applyRate(fresh);
    if (!(this.target > 0)) this.seek(false);
    this.beginPosHold(fresh, c);
    this.fresh = { el: fresh, key: c.key, id: c.id, from: target };
    if (this.want) this.playAfterJump(fresh, c, 'start');
    return true;
  }

  /** Das frische Element hat FRESH_OK_S Sekunden gespielt: eine Zeile, dann ist die Beobachtung zu Ende */
  private freshOk(el: DeckEl) {
    const f = this.fresh;
    if (!f || f.el !== el || this.clip?.key !== f.key) return;
    if (el.paused || el.seeking || el.currentTime - f.from < FRESH_OK_S) return;
    this.diag(`deck: fresh element ${f.id} ok`);
    this.fresh = null;
  }

  // ---- Runde 25: Warten auf Daten nach einem Ende vor der echten Dauer ----

  /** Größte je gemeldete endliche Dauer dieses Moments merken (duration, suchbarer Bereich, Puffer-Ende). Die Zeile "dur drop" schreibt der Listener durationchange (Runde 27). */
  private noteDur(el: DeckEl, key: string) {
    const prev = this.realDur.get(key);
    let best = prev ?? 0;
    const d = el.duration;
    const maxEnd = (b: BufRanges | null | undefined): number => {
      let m = 0;
      try {
        for (let i = 0; b && i < b.length; i++) m = Math.max(m, b.end(i));
      } catch {
        /* kein Medium */
      }
      return m;
    };
    if (Number.isFinite(d) && d > best) best = d;
    best = Math.max(best, maxEnd(el.seekable), maxEnd(el.buffered));
    if (best > 0 && best !== prev) {
      this.realDur.set(key, best);
      if (this.realDur.size > 40) this.realDur.delete(this.realDur.keys().next().value as string);
    }
  }

  /**
   * Ein ended vor der echten Dauer (iOS setzte duration auf currentTime): kein Ende, das Element wartet stumm auf Daten am Ziel. Kein erneuter Sprung, kein Neustart.
   * true: das ended ist behandelt (Warten läuft oder beginnt jetzt). false: nicht zuständig, die bisherige Kette entscheidet (lokale Quelle, echte Dauer unbekannt,
   * Position vor dem Schnittbeginn, leeres ended, Wunsch pausiert, Warten schon abgelaufen oder zu oft).
   */
  private tryWait(el: DeckEl, c: DeckClip): boolean {
    if (this.dataWait) return this.dataWait.el === el && this.dataWait.key === c.key;
    if (this.isLocal || this.done || this.holding || !this.want || el !== this.el) return false;
    if (this.dw.timedOut || this.dw.n >= DATA_WAIT_MAX) return false;
    this.noteDur(el, c.key);
    const t = el.currentTime;
    const real = this.realDur.get(c.key);
    if (!beforeRealEnd({ t, real })) return false;
    if (positionBeforeStart({ t, target: this.target })) return false;
    const dur = el.duration;
    if ((!Number.isFinite(dur) || dur === 0) && t < 0.5) return false;
    // Sind am Ziel schon Daten da (Puffer deckt die Stelle, Dauer echt), fehlt nichts: die bisherige Kette stellt wie vor Runde 25 her
    if (dataReady({ at: t, t, dur, rs: el.readyState, buffered: el.buffered })) return false;
    this.dw.n++;
    this.diag(`deck: end before real end ${c.id} t=${t.toFixed(1)} dur=${Number.isFinite(dur) ? dur.toFixed(1) : String(dur)} real=${(real as number).toFixed(1)}, waiting for data`);
    this.live = false;
    this.samp = null;
    this.froz = null;
    // Stumm halten wie bei der Position (verdeckt nie: iOS verweigert dort das Entstummen vermutlich). Runde 30: nie stumm, das Element wartet pausiert.
    if (this.neverMuted) {
      if (!el.paused) this.halt(el, 'app: wait for data');
    } else if (!this.hidden()) {
      const h = this.posHold;
      if (h && h.el === el) clearTimeout(h.stop);
      else {
        this.releaseHold();
        this.posHold = { el, key: c.key, id: c.id, target: t, real: el.muted, t0: Date.now(), tick: setInterval(() => this.checkPosHold(), 100), stop: setTimeout(() => {}, 0) };
        el.muted = true;
      }
    }
    this.showLoading();
    this.dataWait = {
      el,
      key: c.key,
      id: c.id,
      at: t,
      t0: Date.now(),
      prog0: this.prog,
      nudged: false,
      tick: setInterval(() => this.pollData(), DATA_POLL_MS),
      stop: setTimeout(() => this.waitTimeout(), DATA_WAIT_MS),
    };
    this.pollData();
    return true;
  }

  /** Warten beenden, ohne etwas zu tun (neuer Ausschnitt, Aufräumen, Ende des Wartens). Die Stummhaltung des Wartens geht mit. */
  private endWait() {
    const w = this.dataWait;
    if (!w) return;
    clearInterval(w.tick);
    clearTimeout(w.stop);
    this.dataWait = null;
    if (this.posHold?.el === w.el) this.releaseHold();
  }

  /** Abfrage und Ereignisse (progress, canplay, durationchange, timeupdate, seeked): sind Daten am Ziel da, Position prüfen, play(), Ton an */
  private pollData() {
    const w = this.dataWait;
    if (!w) return;
    const el = w.el;
    const c = this.clip;
    if (el !== this.el || !c || c.key !== w.key || this.done) {
      this.endWait();
      return;
    }
    if (el.seeking) return;
    if (!dataReady({ at: w.at, t: el.currentTime, dur: el.duration, rs: el.readyState, buffered: el.buffered })) {
      // iOS stößt in diesem Zustand vermutlich kein Nachladen an (im Protokoll nicht belegt): bis dahin kein progress, dann genau ein sanfter Anstoß, ohne load()
      if (!w.nudged && Date.now() - w.t0 >= DATA_NUDGE_MS && this.prog === w.prog0) {
        w.nudged = true;
        this.diag(`deck: data wait nudge ${w.id} no progress after ${DATA_NUDGE_MS} ms`);
        try {
          el.currentTime = stepBackPos(w.at, c.start - this.offset);
        } catch {
          /* iOS lehnt die Position ab */
        }
      }
      return;
    }
    const ms = Date.now() - w.t0;
    this.endWait();
    try {
      // im Ende-Zustand mit Rückschritt, sonst springt play() auf 0
      const pos = restartPos({ ended: el.ended, dur: el.duration, at: w.at, startEl: c.start - this.offset });
      if (Math.abs(el.currentTime - pos) > 0.05) el.currentTime = pos;
    } catch {
      /* iOS lehnt die Position ab */
    }
    this.diag(`deck: data ready ${w.id} t=${el.currentTime.toFixed(1)} after ${ms} ms, play`);
    if (this.want) this.kick('wait');
  }

  private waitTimeout() {
    const w = this.dataWait;
    if (!w) return;
    const el = w.el;
    const alive = el === this.el && this.clip?.key === w.key && !this.done;
    this.endWait();
    if (!alive) return;
    this.diag(`deck: data wait timeout ${w.id} after ${DATA_WAIT_MS} ms`);
    this.dw.timedOut = true;
    // ab jetzt die bisherige Kette: Wiederherstellung, Neuaufbau, Schleifensicherung
    this.endedCheck(el, 'poll');
  }

  /**
   * Runde 17: Wiederherstellung eines Ausschnitts, dessen Element ein falsches Ende meldete oder mit stehender Zeit hängt. Erst Position auf die Startstelle und
   * play() (soft), dann die Quelle am selben Element neu aufbauen (start() mit unveränderter Spur wie in bail(), nach loadedmetadata springt seek(true) auf target).
   * Höchstens CLIP_RECOVER_MAX je Ausschnitt, danach der Fehlerweg des Hosts. Verdeckt kein Quellwechsel: der Neuaufbau wartet auf die Rückkehr (heartbeat).
   */
  private recover(el: DeckEl, kind: 'ended' | 'frozen', t: number, forceRebuild = false) {
    const c = this.clip;
    if (!c || this.done || !this.want || this.holding) return;
    if (this.recov.gaveUp) return;
    let step = recoverStep({ n: this.recov.n, kind, hidden: this.hidden() });
    // Runde 22: der Positionswächter verlangt den Neuaufbau (ein weicher Schritt hat die Stelle nicht gehalten)
    if (forceRebuild && step === 'soft') step = this.hidden() ? 'defer' : 'rebuild';
    // Läuft der Ausschnitt schon, bleibt die Stelle erhalten, am Start (t auf der Startstelle) gilt target
    const mid = Number.isFinite(t) && t > this.target && (c.end === undefined || t + this.offset < c.end - END_TOL);
    const at = mid ? t : this.target;
    if (step === 'giveup') {
      this.recov.gaveUp = true;
      this.diag(`deck: recovery gave up ${c.id}`);
      this.loading(false);
      this.diag(`deck error ${c.id}`);
      this.sink?.error();
      return;
    }
    if (step === 'defer') {
      this.recov.pending = true;
      return;
    }
    // Runde 29: stehende Zeit am Ende ist derselbe Kollaps: vor der Wiederherstellung am selben Element zuerst das Ausweichen auf ein frisches (endedCheck und earlyEnded tun es schon)
    if (kind === 'frozen' && this.dodgeCollapse(el, c) === 'dodged') return;
    this.recov.n++;
    this.recov.at = Date.now();
    this.recov.pending = false;
    this.froz = null;
    this.samp = null;
    if (step === 'soft') {
      // Runde 22: steht das Element im Ende-Zustand, hebt dieselbe Position ended nicht auf, und play() sprang auf 0. Darum ein kleiner Rückschritt.
      const pos = restartPos({ ended: el.ended, dur: el.duration, at, startEl: c.start - this.offset });
      if (pos !== at) this.diag(`deck: restart at reported end ${c.id} t=${at.toFixed(1)} dur=${Number.isFinite(el.duration) ? el.duration.toFixed(1) : String(el.duration)}, stepping back`);
      try {
        el.currentTime = pos;
      } catch {
        /* iOS lehnt die Position ab */
      }
      // Runde 20: kein Puffer hinter der Stelle (falsches Ende an der Grenze des Geladenen): sofort Laden zeigen statt "spielt" bis zum ersten Zeitfortschritt. Keine weitere Aktion.
      const starve = !this.aheadOk(el);
      if (starve) this.guard = el;
      this.kick('restart');
      if (starve) {
        this.diag(`deck: restart without buffer ${c.id} t=${at.toFixed(1)} buf=${this.bufText(el, at)}`);
        this.showLoading();
      }
      return;
    }
    this.diag(`deck: rebuilding source ${c.id} from ${(at + this.offset).toFixed(1)}`);
    this.rebuildSource(c, at);
  }

  /** Quelle am selben Element neu aufbauen (ohne Fragment), ab at in Elementzeit */
  private rebuildSource(c: DeckClip, at: number) {
    this.rebuilding = true;
    try {
      this.start(c, this.want, true, Math.max(c.start, at + this.offset), 'recovery');
    } finally {
      this.rebuilding = false;
    }
  }

  /**
   * Runde 17: Takt des Feeds (Abfrage alle 150 ms), nur sichtbar. Leitet "läuft" aus fortschreitender Position ab, wertet el.ended nur bei Plausibilität,
   * löst den Schnitt am Ende auch ohne timeupdate aus und erkennt stehende Zeit. Verdeckt tut der Takt nichts (Tausch nur im Ereignis-Handler, kein load()).
   */
  heartbeat(now = Date.now()) {
    const el = this.el;
    const c = this.clip;
    if (!el || !c || this.done || this.holding || this.hidden()) {
      this.froz = null;
      return;
    }
    // Ein vertagter Neuaufbau kommt zurück, sobald die Seite wieder sichtbar ist
    if (this.recov.pending && this.want && !this.recov.gaveUp) {
      this.recover(el, 'frozen', el.currentTime);
      return;
    }
    if (this.guardPos(el)) return;
    this.inferPlaying(el);
    if (this.played && el.ended) {
      this.endedCheck(el, 'poll');
      return;
    }
    if (c.end !== undefined && !el.paused && el.currentTime + this.offset >= c.end - END_EPS) {
      this.clipEnd('poll');
      return;
    }
    const r = frozen({
      prev: this.froz,
      t: el.currentTime,
      now,
      active: this.want && !el.paused && el.readyState >= 3 && (this.played || this.okFor === c),
    });
    this.froz = r.next;
    if (r.frozen) {
      this.froz = null;
      // Runde 18: stehende Zeit ohne ended ist Puffern (iOS meldet dabei oft kein waiting). Kein Neuaufbau, die geladenen Bytes bleiben. Nur Lade-Zustand.
      if (!el.ended) {
        this.bufferingInferred(el, c);
        return;
      }
      this.diag(`deck: time frozen ${c.id} t=${el.currentTime.toFixed(1)} ended=${el.ended}, recovering`);
      this.recover(el, 'frozen', el.currentTime);
    }
  }

  /** Runde 18: stehende Zeit bei ended=false: wie das waiting-Ereignis als Laden anzeigen. Sobald die Zeit wieder läuft, leitet inferPlaying (oder playing) es zurück. */
  private bufferingInferred(el: DeckEl, c: DeckClip) {
    if (this.bufNoted !== c.key) {
      this.bufNoted = c.key;
      this.diag(`deck: buffering inferred (time not advancing) ${c.id} t=${el.currentTime.toFixed(1)}`);
    }
    this.showLoading();
  }

  /** Runde 18: Zähler der ankommenden Daten des aktiven Elements (Puffer in Zehntelsekunden, progress-Ereignisse). Wächst nur, wenn Daten kommen. */
  bytes(sink: DeckSink): number {
    const el = this.el;
    if (this.sink !== sink || !el) return 0;
    let end = 0;
    try {
      for (let i = 0; i < (el.buffered?.length ?? 0); i++) end = Math.max(end, el.buffered!.end(i));
    } catch {
      /* kein Medium */
    }
    return this.prog + Math.round(end * 10) + (el.readyState >= 2 ? 1 : 0);
  }

  /**
   * Runde 22: Positionswächter. Läuft ein Ausschnitt und liegt die Position deutlich vor dem Schnittbeginn (iOS sprang nach play() im Ende-Zustand auf 0, der Ausschnitt
   * spielte vom Folgenanfang), springt das Element sofort auf target zurück und spielt weiter. Höchstens POS_FIX_MAX Korrekturen je Ausschnitt, danach Neuaufbau der Quelle.
   * Still vor Metadaten und erstem Seek (armed), im Neuaufbau, gehalten, pausiert vom Menschen und bei Live (duration Infinity). true: die Position war falsch (korrigiert oder Neuaufbau).
   */
  private guardPos(el: DeckEl): boolean {
    const c = this.clip;
    if (!c || el !== this.el || this.done || this.holding || this.rebuilding || !this.want || !this.armed || this.dataWait) return false;
    if (el.paused && !el.ended) return false;
    if (el.readyState < 1 || el.seeking || el.duration === Number.POSITIVE_INFINITY) return false;
    const t = el.currentTime;
    if (!positionBeforeStart({ t, target: this.target })) return false;
    if (this.posFix.n >= POS_FIX_MAX) {
      this.diag(`deck: position before clip start ${c.id} t=${t.toFixed(1)} target=${this.target.toFixed(1)}, rebuilding`);
      this.recover(el, 'frozen', t, true);
      return true;
    }
    this.posFix.n++;
    this.diag(`deck: position before clip start ${c.id} t=${t.toFixed(1)} target=${this.target.toFixed(1)}, reseek`);
    this.froz = null;
    this.samp = null;
    try {
      el.currentTime = this.target;
    } catch {
      /* iOS lehnt die Position ab */
    }
    // Steht ended nach der Position noch (leere Dauer), spielt play() wieder von 0: dann wartet es auf die Abfrage (falsches ended mit Rückschritt)
    if (el.paused && !el.ended) this.kick('restart');
    return true;
  }

  /** Neuer Ausschnitt im Element: Zähler und Zeitgeber der Neustarts zurücksetzen */
  private resetEarly() {
    this.earlyN = 0;
    this.earlyGaveUp = false;
    if (this.earlyTimer) clearTimeout(this.earlyTimer);
    this.earlyTimer = null;
  }

  /**
   * Runde 13 (Diag 14.11. 05:47): iOS meldete 29 ms nach dem Sprung an die Startstelle "ended" (played=false, rs=4) und pausierte das Element. Das play() des Starts
   * blieb offen, und niemand rief es erneut auf, bis ein Tipp kam. Jetzt: springt zurück an die Startstelle und ruft play() erneut, höchstens EARLY_RESTART_MS.length mal.
   * Kein Neustart, wenn der Mensch pausiert hat (want), der Ausschnitt zu Ende ist (done, Position am Ende), ein anderer geladen wurde, die Tippfläche steht oder die
   * Datei kürzer ist als die Startstelle (anderer Fehler: wie ein unspielbarer Moment behandeln).
   */
  private earlyEnded(el: DeckEl) {
    const c = this.clip;
    if (el !== this.el || !c || this.done || !this.want || this.played || this.holding || this.dataWait) return;
    if (this.needTapKey === c.key) return;
    const at = el.currentTime + this.offset;
    if (c.end !== undefined && at >= c.end - END_EPS) return;
    // Runde 27: Kollaps beim Start (play stumm vor dem Sprung, Ende kurz nach der Position): ein frisches Element statt Neustart am selben
    if (this.dodgeCollapse(el, c) === 'dodged') return;
    if (this.earlyTimer) return;
    const dur = el.duration;
    // Runde 27: nicht, wenn die echte Dauer des Moments (frühere Elemente, Puffer) hinter der Startstelle liegt: dann ist die gemeldete Dauer ein Kollaps, keine kurze Datei
    const real = this.realDur.get(c.key);
    if (Number.isFinite(dur) && dur > 0 && dur + this.offset < c.start && !(real !== undefined && real + this.offset >= c.start)) {
      if (!this.earlyGaveUp) {
        this.earlyGaveUp = true;
        this.diag(`deck: clip start beyond duration ${dur.toFixed(1)}`);
        this.loading(false);
        this.diag(`deck error ${c.id}`);
        this.sink?.error();
      }
      return;
    }
    if (this.earlyN >= EARLY_RESTART_MS.length) {
      if (!this.earlyGaveUp) {
        this.earlyGaveUp = true;
        this.diag('deck: early ended, giving up (tap starts)');
      }
      return;
    }
    const n = ++this.earlyN;
    this.earlyTimer = setTimeout(() => {
      this.earlyTimer = null;
      // Zwischenzeitlich pausiert, beendet, gespielt oder ein anderer Ausschnitt geladen: nichts tun
      if (el !== this.el || this.clip !== c || this.done || !this.want || this.played || this.holding || this.dataWait || this.needTapKey === c.key) return;
      this.diag(`deck: early ended, restart ${n} rs=${el.readyState} t=${el.currentTime.toFixed(1)}`);
      try {
        // Runde 22: im Ende-Zustand mit Rückschritt, sonst springt play() auf 0
        el.currentTime = restartPos({ ended: el.ended, dur: el.duration, at: this.target, startEl: c.start - this.offset });
      } catch {
        /* iOS lehnt die Position ab */
      }
      this.kick('restart');
    }, EARLY_RESTART_MS[n - 1]);
  }

  private seek(afterMeta: boolean) {
    const el = this.el;
    if (!el || !this.clip) return;
    try {
      if (afterMeta ? Math.abs(el.currentTime - this.target) > SEEK_TOL : this.target > 0 || el.currentTime !== 0) el.currentTime = this.target;
    } catch {
      /* iOS setzt die Position erst nach loadedmetadata */
    }
  }

  /** Quelle setzen und, wenn gewollt, sofort play(). Läuft synchron, auch im Hintergrund. */
  private start(clip: DeckClip, play: boolean, forcePlain = false, from = clip.start, forceWhy?: string, held = false) {
    if (!held) {
      // Kaltstart: der Ausschnitt liegt im Vorrat, die Blob-URL entsteht gleich. Kurz warten statt vom Netz zu starten (Brief 02). Nur wenn nichts läuft.
      if (this.holding?.key === clip.key) {
        this.want = play;
        return;
      }
      const idle = !this.clip || this.done;
      // Runde 9: der Start kommt ohne Wartezeit auf den IFrame, also noch vor dem Lauf des Kontexts aus der Geste. Die Spur wird erst danach gewählt.
      const ctxWait = idle ? this.deps.settle?.(clip, forcePlain) ?? null : null;
      const store = !this.deps.local(clip.key) && idle ? this.pending?.(clip.id, clip.key) ?? null : null;
      if (ctxWait || store) {
        const wait = ctxWait && store ? Promise.all([ctxWait, store]).then((r) => r[1]) : (store ?? ctxWait)!;
        this.hold(clip, play, forcePlain, from, forceWhy, wait, ctxWait ? (store ? 'audio context or host check, and storage' : 'audio context or host check') : 'storage');
        return;
      }
    }
    this.holding = null;
    this.releaseHold();
    this.noteClip(clip.key);
    this.armed = false;
    // Runde 12: der Vorrat hält genau diesen Ausschnitt. Sein Element wird übernommen, auch wenn es noch lädt (es hat schon Bytes an der richtigen Stelle).
    // Verworfen wird nur ein Eintrag mit Fehler oder einer Spur, die nicht mehr passt, dann lädt der Start das Element neu.
    const inPool = this.entries.find((x) => x.clip.key === clip.key) ?? this.kept.find((x) => x.clip.key === clip.key);
    if (inPool && this.adopt(inPool, play, forcePlain, from)) return;
    const loc = this.deps.local(clip.key);
    // Spurwahl (Lautheit): das Element der Spur, bei Misserfolg der Kette das unveränderte
    const pick = this.deps.lane?.(clip, !!loc, forcePlain) ?? { lane: 'plain' as const, why: 'no value' };
    let lane = pick.lane;
    let why = forcePlain && forceWhy ? forceWhy : pick.why;
    // Runde 26: der verlassene Moment bleibt in seinem Element, der Start lädt in ein freies (Zurückwischen ohne Kaltstart)
    let prev = this.clip && this.clip.key !== clip.key ? this.snapActive() : null;
    const pickEl = (l: Lane): DeckEl => {
      if (prev) {
        const f = this.freeEl(l);
        if (f) return f;
        prev = null;
      }
      return this.ensure(l);
    };
    let target = pickEl(lane);
    // Runde 29: läuft gerade eine Geste und das Element ist nicht freigeschaltet, nimmt der Start (Netz, ferne Startstelle) zuerst ein freigeschaltetes freies Element: dort greift "erst Sprung, dann play"
    const pickUnlocked = (l: Lane, cur: DeckEl): DeckEl => {
      if (!this.unlockSilent || loc || !(from > 0) || this.unlockedEls.has(cur) || Date.now() - this.gestAt > GESTURE_WINDOW_MS) return cur;
      return this.pool[l].find((e) => e !== this.el && this.unlockedEls.has(e) && !this.entryOf(e) && !this.keptOf(e)) ?? cur;
    };
    target = pickUnlocked(lane, target);
    let chain: { linear: () => number } | null = null;
    if (lane === 'level') {
      chain = this.deps.chain?.(target, clip.gain ?? 0) ?? null;
      if (!chain) {
        lane = 'plain';
        why = 'no audio graph';
        target = pickUnlocked('plain', pickEl('plain'));
      }
    }
    const old = this.el;
    this.el = target;
    this.lane = lane;
    this.loudLinear = chain ? chain.linear : null;
    this.loudInfo = chain ? { db: clip.gain ?? 0, how: 'web audio' } : { db: 0, how: `unchanged: ${why}` };
    if (old && old !== target) {
      // Spurwechsel: das alte Element anhalten und die Quelle freigeben (höchstens 3 Elemente mit Quelle), Ton übernehmen (das Tempo setzt applyRate gleich)
      if (!this.neverMuted) target.muted = this.realMuted(old);
      this.halt(old, 'app: lane switch');
      if (prev && prev.el === old) this.addKept(prev);
      else this.clearSrc(old);
    }
    const el = target;
    this.clip = clip;
    this.done = false;
    this.nudged = false;
    this.live = false;
    this.played = false;
    this.resetEarly();
    this.want = play;
    this.inflightAt = 0;
    this.kickTok++;
    this.skipNoted = false;
    this.needTapKey = '';
    this.offset = loc?.offset ?? 0;
    this.isLocal = !!loc;
    this.coldNet = !loc;
    this.resumeFrom = from;
    this.target = Math.max(0, from - this.offset);
    this.history.push(clip.key);
    if (this.history.length > 200) this.history.shift();
    this.snd = { muted: isSilent(this.soundView(el)), playing: false, refused: false };
    // Untertitel (Issue 15): bei Quell- und Spurwechsel die Zeit übernehmen und halten, bis das Element selbst wieder misst
    this.sink?.time?.(from, el.playbackRate || 1, false);
    // Eine Zeile je Start: kam die Quelle aus dem Offline-Vorrat (Blob) oder aus dem Netz (Issue 14)
    this.diag(`deck: src ${loc ? 'local' : 'net'} ${clip.id}`);
    // Runde 24: nie ein Medienfragment (#t=), die Position kommt nach loadedmetadata (iOS meldete mit dem Fragment duration gleich Startstelle und ended)
    this.noteEnv();
    this.markLoad(el);
    el.src = loc?.url ?? clip.url;
    el.load();
    // Netzstart ohne Daten (readyState < 3 nach load() immer): die App zeigt "Loading" bis canplay, nie ein stiller Ausfall
    this.loading(!loc && el.readyState < 3);
    try {
      this.onStart?.({ clip, local: !!loc });
    } catch {
      /* Zähler darf den Start nie stören */
    }
    // load() setzt das Tempo auf den Standard zurück: Standard und aktuelles Tempo gemeinsam setzen
    this.applyRate(el);
    // Issue 58: ein Netzstart mit Startpunkt springt erst nach loadedmetadata (seek(true)): ein Sprung vor den Metadaten ließe den Host zweimal an die späte Stelle suchen.
    // Runde 24: ohne Fragment bleibt das Element bis zur bestätigten Position stumm.
    if (!(this.target > 0 && !loc)) this.seek(false);
    if (el.readyState >= 1) this.posSetLine(el);
    this.beginPosHold(el, clip);
    if (play) this.playAfterJump(el, clip, 'start');
  }

  private hold(clip: DeckClip, play: boolean, forcePlain: boolean, from: number, forceWhy: string | undefined, wait: Promise<boolean>, what = 'storage') {
    const token = ++this.holdToken;
    this.holding = clip;
    this.clip = clip;
    this.done = false;
    this.want = play;
    this.live = false;
    this.played = false;
    this.resetEarly();
    this.diag(`deck: hold ${clip.id} for ${what}`);
    const t0 = Date.now();
    const timeout = new Promise<boolean>((r) => setTimeout(() => r(false), HOLD_MS));
    void Promise.race([wait, timeout]).then((ok) => {
      if (token !== this.holdToken || this.holding !== clip) return;
      this.diag(`deck: hold ${clip.id} ${ok ? `released, ${what} ready` : what === 'audio context or host check' ? 'timeout, unchanged' : 'timeout, from net'} after ${Date.now() - t0} ms`);
      this.start(clip, this.want, forcePlain, from, forceWhy, true);
    });
  }

  /** Messung für die Untertitel: Quellzeit des Elements (currentTime plus Versatz), Tempo, und ob es gerade Ton liefert */
  private tick(el: DeckEl) {
    // Runde 24: bis zur bestätigten Position ist die Zeit des Elements die vom Folgenanfang: Untertitel und Sperrbildschirm behalten die Startzeit
    if (this.posHold?.el === el) return;
    this.sink?.time?.(el.currentTime + this.offset, el.playbackRate || 1, !el.paused && this.live);
    this.position(el);
  }

  private stateText(el: DeckEl) {
    return `rs=${el.readyState} muted=${el.muted} t=${el.currentTime.toFixed(1)}`;
  }

  // ---- Runde 29: erst der Sprung, dann der erste play() ----

  /** Der Sprung auf das Ziel ist ausgeführt und abgeschlossen: Metadaten da, kein Seek unterwegs, Position an der Startstelle */
  private jumpDone(el: DeckEl): boolean {
    return el.readyState >= 1 && !el.seeking && Math.abs(el.currentTime - this.target) <= SEEK_TOL;
  }

  /**
   * Erster play() eines Ausschnitts (Start, Ausweichen, Neuaufbau, Tausch). Netzquelle, ferne Startstelle, Element freigeschaltet: kein play(), bevor der Sprung abgeschlossen ist
   * (seeked, höchstens JUMP_WAIT_MS, ohne Metadaten JUMP_META_MS). Alles andere spielt sofort wie bisher: ein nicht freigeschaltetes Element braucht den play() in der Geste.
   */
  private playAfterJump(el: DeckEl, c: DeckClip, why: 'start' | 'swap', jumped = false) {
    // jumped: ein bereiter Eintrag des Vorrats hat den Sprung schon abgeschlossen (checkEntry prüft Metadaten, Position und seeked)
    // Runde 30: wartet der Ausschnitt ohnehin auf den Tipp (ohne Geste, Ton aus), gilt der Sprung auch für ein nicht freigeschaltetes Element: die Tippfläche steht erst danach
    const blocked = this.neverMuted && (this.soundOff || !this.gestSeen);
    if (!this.unlockSilent || this.isLocal || !(this.target > 0) || (!blocked && !this.unlockedEls.has(el)) || jumped || this.jumpDone(el)) {
      this.kick(why);
      return;
    }
    this.endJump();
    this.jump = { el, key: c.key, id: c.id, t0: Date.now(), why, timer: setTimeout(() => this.releaseJump('timeout'), el.readyState >= 1 ? JUMP_WAIT_MS : JUMP_META_MS) };
    this.diag(`deck: play waits for jump ${c.id} rs=${el.readyState} target=${this.target.toFixed(1)}`);
    if (el.readyState >= 1) {
      this.seek(true);
      this.jumpCheck(el, 'position');
    }
  }

  private jumpCheck(el: DeckEl, how: string) {
    if (this.jump?.el === el && this.jumpDone(el)) this.releaseJump(how);
  }

  private releaseJump(how: string) {
    const j = this.jump;
    if (!j) return;
    clearTimeout(j.timer);
    this.jump = null;
    if (j.el !== this.el || this.clip?.key !== j.key || this.done || !this.want || this.holding) return;
    this.diag(`deck: play after jump ${j.id} (${how}) t=${j.el.currentTime.toFixed(1)} after ${Date.now() - j.t0} ms`);
    this.kick(j.why);
  }

  private endJump() {
    if (!this.jump) return;
    clearTimeout(this.jump.timer);
    this.jump = null;
  }

  /** Runde 30: Start oder Tausch wartet auf einen Tipp, ohne dass play() lief. Eine Zeile je Ausschnitt, der Host zeigt die Tippfläche (nie in der laufenden Geste, nie verdeckt). */
  private tapWait(c: DeckClip, why: string) {
    // Ein pointerdown ist auf iOS keine Aktivierung: der Tipp bringt pointerup, touchend und click gleich nach, unlock stößt dann an
    const soft = !this.gestSeen && this.lastGesture === 'pointerdown' && Date.now() - this.gestAt <= GESTURE_WINDOW_MS;
    if (this.waitTapKey === c.key) return;
    this.waitTapKey = c.key;
    this.diag(`deck: waiting for tap ${c.id} (no gesture or sound off)`);
    this.sink?.state(PAUSED);
    if (soft || this.hidden()) return;
    this.needTapKey = c.key;
    this.needTapNoted = false;
    if (this.el) this.snd = reduceSound(this.snd, 'refused', this.soundView(this.el));
    this.sink?.sound?.();
    try {
      this.onRefused?.(c.id, `tap (${why})`);
    } catch (err) {
      this.diag(`deck onRefused failed ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private kick(why: string) {
    const el = this.element;
    // Runde 25: wartet das Element auf Daten am Ziel, startet nur das Warten selbst (why wait) ein play()
    if (this.dataWait && why !== 'wait') return;
    // Runde 29: der erste play() wartet auf den Sprung (releaseJump ruft kick erst, wenn this.jump leer ist). Der Wunsch (want) bleibt stehen und gilt dann.
    if (this.jump && this.jump.el === el) return;
    // Runde 30: nie stumm spielen. Ohne Geste oder mit "Ton aus" bleibt das Element pausiert (Laden und Sprung laufen), der Tipp startet laut.
    if (this.neverMuted && this.clip && (this.soundOff || !this.gestSeen)) {
      this.tapWait(this.clip, why);
      return;
    }
    this.waitTapKey = '';
    if (this.neverMuted && el.muted && !this.silentEl(el)) {
      if (!this.mutedBlockNoted) {
        this.mutedBlockNoted = true;
        this.diag(`deck: muted play blocked ${this.idOf(el)} ${why}`);
      }
      el.muted = false;
    }
    // Start oder Tausch wurde abgelehnt: sichtbar kein play() von selbst (soundGuard, canplay, resume). Nur ein Tipp (Geste in den letzten Millisekunden) startet wieder. Verdeckt bleibt die Rückkehr-Logik wie bisher.
    if (this.needTapKey && this.clip?.key === this.needTapKey && why !== 'start' && why !== 'swap' && !this.hidden() && Date.now() - this.actAt > GESTURE_WINDOW_MS) {
      if (!this.needTapNoted) {
        this.needTapNoted = true;
        this.diag(`deck play skipped (${why}): waiting for a tap ${this.stateText(el)}`);
      }
      return;
    }
    if (skipKick({ inflightAt: this.inflightAt, readyState: el.readyState }, Date.now(), why)) {
      if (!this.skipNoted) {
        this.skipNoted = true;
        this.diag(`deck play skipped (${why}): one in flight ${this.stateText(el)}`);
      }
      return;
    }
    const tok = ++this.kickTok;
    this.inflightAt = Date.now();
    const n = ++this.plays;
    if (this.hidden()) this.hiddenStats.plays++;
    this.diag(`deck play#${n} ${why} ${this.stateText(el)}`);
    let p: Promise<void> | undefined;
    const sr = this.st(el);
    sr.playAt = Date.now();
    if (!sr.playN) sr.playN = ++this.ev;
    try {
      p = el.play();
    } catch (e) {
      if (tok === this.kickTok) this.inflightAt = 0;
      this.rejected(e, why);
      return;
    }
    p?.then?.(
      () => {
        if (tok === this.kickTok) this.inflightAt = 0;
        this.unlocked = true;
        // Ein angenommenes play() schaltet dieses Element frei, und der Ausschnitt braucht keinen Tipp mehr
        if (!this.unlockedEls.has(el)) this.unlockWho.set(el, 'swipe');
        this.unlockedEls.add(el);
        this.noteAllUnlocked();
        if (el === this.el) this.needTapKey = '';
        if (el === this.el) this.okFor = this.clip;
        this.diag(`deck play#${n} ok`);
        // Nach jedem erfüllten play() füllt der Host den Vorrat auf (Brief 14, Schritt 2)
        if (el === this.el) this.onPlayed?.();
      },
      // Ein Ergebnis des früheren Elements (Spurwechsel) zählt nicht
      (e: unknown) => {
        if (tok === this.kickTok) this.inflightAt = 0;
        if (el === this.el) this.rejected(e, why);
      },
    );
    // Ein Element, das nach play() nicht mehr spielt (iOS hat das play() vor den Metadaten still verworfen), gibt den Anstoß wieder frei
    if (p === undefined || el.paused) this.inflightAt = 0;
  }

  // ---- Vorrat (Entscheidung 52, Brief 14): fünf Elemente halten die nächsten fünf Momente fertig geladen, gesperrt tauscht Weiter nur noch die Rollen ----

  private entryOf(el: DeckEl): PoolEntry | undefined {
    return this.entries.find((e) => e.el === el);
  }

  /** Eintrag ist abspielbar: bereit und nicht von iOS verworfen (readyState fiel auf 0, nachdem das Element schon Daten hatte) */
  private usable(e: PoolEntry): boolean {
    return e.ready && !(e.rsAtReady > 0 && e.el.readyState === 0);
  }

  /** Wie viele Elemente des Vorrats sind bereit (Diagnose, Statuszeile) */
  /** Rolle eines Deck-Elements für die Diag-Zeile "media: ...": pool (hält einen der nächsten Momente) oder deck (aktiv oder frei). null: nicht von diesem Deck. */
  roleOf(el: unknown): 'pool' | 'deck' | null {
    const e = el as DeckEl;
    if (!this.laneOf.has(e)) return null;
    return this.entryOf(e) ? 'pool' : 'deck';
  }

  readyCount(): number {
    return this.entries.filter((e) => this.usable(e)).length;
  }

  /** Der Vorrat in Reihenfolge der Warteschlange, bereit oder noch ladend (Diagnose, Tests) */
  poolInfo(): PoolInfo[] {
    return this.entries.map((e) => ({ key: e.clip.key, id: e.clip.id, ready: this.usable(e) }));
  }

  /**
   * Hält der Vorrat diesen Ausschnitt bereit? Ohne key: ist überhaupt ein Element bereit?
   * unlockedOnly (iOS, Runde 8): nur ein Element zählt, das schon durch ein angenommenes play() freigeschaltet ist, denn nur das startet ohne Geste.
   */
  poolReady(key?: string, unlockedOnly = false): boolean {
    const ok = (e: PoolEntry) => this.usable(e) && (!unlockedOnly || this.unlockedEls.has(e.el));
    return key === undefined ? this.entries.some(ok) : this.entries.some((e) => e.clip.key === key && ok(e));
  }

  /**
   * Vorrat auffüllen (Schritt 1, Brief 14b): aus den Kandidaten (die nächsten Momente der Warteschlange, in Reihenfolge) kommen POOL Ausschnitte in je ein
   * freies Element (Quelle setzen, load(), Position auf den Start, bereit bei canplaythrough oder readyState 4, lokal genügt 3). Die Auswahl nimmt lokale
   * Quellen zuerst, das Netz füllt nur auf. Der nächste Kandidat bleibt immer dabei, damit der sichtbare Wisch auf ihn sofort tauscht. Lokale laden auch
   * zuerst. Nur wenn die App sichtbar ist: verdeckt lädt iOS nichts nach, und ein load() verdeckt hängt das Element für immer. Bereits geladene Einträge
   * bleiben. Was aus der Auswahl gefallen ist oder von iOS verworfen wurde, wird ersetzt. Gibt die Zahl der Einträge zurück (bereit oder ladend).
   * Brief 22 (Entscheidung 57): der Vorrat füllt sich sofort beim Start, vor dem ersten play() und vor der ersten Geste. Runde 29: die Geste spielt keinen Eintrag an,
   * Elemente mit Netzquelle schalten sich im Wisch frei (kick), freie Elemente die Geste mit der stillen Inline-Quelle (silentUnlock). Mit UNLOCK_SILENT = false spielt
   * die Geste jedes Element des Vorrats stumm an (gesturePool).
   */
  fill(clips: readonly DeckClip[], locOf: (key: string) => LocalClip | undefined = this.deps.local, activePending = false): number {
    if (!this.deps.standby || this.hidden()) return this.entries.length;
    this.lastFill = { clips, locOf, activePending };
    // Runde 30: vor der ersten Geste lädt der Vorrat nichts (kein Element mit Netzquelle ohne Freischaltung). openPool holt es nach.
    if (this.poolClosed()) return this.entries.length;
    const cand: DeckClip[] = [];
    for (const c of clips) {
      if (this.clip?.key === c.key && !this.done) continue;
      if (!cand.some((w) => w.key === c.key)) cand.push(c);
    }
    const loc = new Map(cand.map((c) => [c.key, locOf(c.key)] as const));
    let changed = false;
    // Runde 26: ein behaltener Moment, der wieder zu den nächsten gehört (Zurückwischen: der verlassene ist jetzt der nächste), geht in den Vorrat zurück, geladen und bereit
    const firstKeys = new Set(cand.map((c) => c.key));
    for (const k of [...this.kept]) {
      if (!firstKeys.has(k.clip.key) || this.entries.some((e) => e.clip.key === k.clip.key)) continue;
      this.kept = this.kept.filter((x) => x !== k);
      this.entries.push(k);
      try {
        if (!k.el.paused) k.el.pause();
        if (Math.abs(k.el.currentTime - k.target) > SEEK_TOL / 2) k.el.currentTime = k.target;
      } catch {
        /* Position nicht setzbar, der Tausch setzt sie neu */
      }
      changed = true;
    }
    // Auswahl: der nächste Kandidat, dann alle lokalen in Reihenfolge, dann Netz bis POOL (Runde 26: minus die behaltenen Elemente). Der Vorrat bleibt in Reihenfolge der Warteschlange.
    const cap = Math.max(1, POOL - this.kept.length);
    const chosen = new Set<string>(cand.slice(0, 1).map((c) => c.key));
    const rest = cand.slice(1);
    for (const c of [...rest.filter((x) => loc.get(x.key)), ...rest.filter((x) => !loc.get(x.key))]) {
      if (chosen.size >= cap) break;
      chosen.add(c.key);
    }
    const want = cand.filter((c) => chosen.has(c.key));
    const keys = new Set(want.map((c) => c.key));
    for (const e of [...this.entries]) {
      if (e.rsAtReady > 0 && e.ready && e.el.readyState === 0) {
        this.evict(e);
        changed = true;
      } else if (!keys.has(e.clip.key)) {
        this.dropEntry(e, 'left window');
        changed = true;
      } else if (!e.local && loc.get(e.clip.key)) {
        // Der Moment wurde nach dem Laden lokal verfügbar (Blob-URL warm): vom Netz auf lokal umstellen, lokal ist in Millisekunden bereit und verdeckt zuverlässig
        this.dropEntry(e, 'now local');
        changed = true;
      }
    }
    // Lokale Quellen zuerst: sie sind in Millisekunden bereit, das Netz braucht Sekunden
    const missing = want.filter((c) => !this.entries.some((e) => e.clip.key === c.key));
    let order = [...missing.filter((c) => loc.get(c.key)), ...missing.filter((c) => !loc.get(c.key))];
    // Runde 18: Vorrang für den aktiven Moment und Schonung des schwachen Netzes (poolBudget). Spielt der aktive nicht, oder ist das Netz schwach: höchstens ein Netz-Abruf
    // in Arbeit, der nächste erst, wenn der vorige bereit ist oder fehlschlug. Spielt er: höchstens zwei. Lokale Quellen kosten kein Netz und laufen immer.
    // Ein Eintrag nach Fehler lädt im schwachen Netz erst nach RELOAD_WAIT_MS, höchstens RELOAD_MAX mal (reloadGate).
    const busy = this.activeBusy(activePending);
    // Ohne aktiven und ohne erwarteten Moment konkurriert nichts um das Netz: bis POOL, im schwachen Netz einzeln
    const idle = !(this.clip && !this.done) && !activePending;
    // Runde 26: ein Eintrag, der "pool slow" meldete und Daten hat (nur der Puffer ist zu dünn), hält das Budget nicht fest (Diag 19.11. 09:16:33: er blockierte jeden weiteren Abruf)
    const inflight = this.entries.filter((e) => !e.local && !e.ready && !(e.slow && e.el.readyState >= 3)).length;
    const nextKey = cand[0]?.key;
    let room = idle && !this.weakNet() ? POOL : poolBudget({ activePlaying: !busy, weakNet: this.weakNet(), inflight });
    let deferred = 0;
    let waitMs = 0;
    order = order.filter((c) => {
      if (loc.get(c.key)) return true;
      const f = this.fails.get(c.key);
      if (f) {
        const g = reloadGate({ weakNet: this.weakNet(), fails: f.n, sinceMs: Date.now() - f.at });
        if (g === 'never') return false;
        if (g === 'wait') {
          const left = RELOAD_WAIT_MS - (Date.now() - f.at);
          waitMs = waitMs ? Math.min(waitMs, left) : left;
          return false;
        }
      }
      // Runde 26: der nächste Moment lädt immer vor, auch im schwachen Netz (solange der aktive spielt oder nichts läuft)
      if (room > 0 || (c.key === nextKey && !busy)) {
        room--;
        return true;
      }
      deferred++;
      return false;
    });
    if (deferred > 0) {
      if (!this.deferNoted) {
        this.deferNoted = true;
        this.diag(`deck: pool fill deferred (${busy ? 'active not playing' : 'net budget'})`);
      }
    } else this.deferNoted = false;
    // Zurückgestellte Abrufe starten, wenn ein Eintrag bereit wird oder fehlschlägt, der aktive spielt oder die Wartezeit nach einem Fehler um ist.
    // Der Zeitgeber ist nur das Netz darunter (neue Prüfung, kein zusätzlicher Abruf über das Budget hinaus).
    if (this.deferTimer) clearTimeout(this.deferTimer);
    this.deferTimer = null;
    if (deferred > 0 || waitMs > 0) {
      this.deferTimer = setTimeout(
        () => {
          this.deferTimer = null;
          this.refillDeferred();
        },
        waitMs > 0 ? waitMs + 50 : FILL_DEFER_MS,
      );
    }
    this.inFill = true;
    try {
      for (const c of order) {
        this.startEntry(c, loc.get(c.key));
        changed = true;
      }
    } finally {
      this.inFill = false;
    }
    // Reihenfolge der Warteschlange herstellen (neue Einträge kamen hinten dazu)
    const rank = new Map(want.map((c, i) => [c.key, i] as const));
    this.entries.sort((a, b) => (rank.get(a.clip.key) ?? 0) - (rank.get(b.clip.key) ?? 0));
    if (changed) {
      const local = this.entries.filter((e) => e.local).length;
      this.diag(`deck: pool fill ${this.entries.length}/${POOL} (local ${local}, net ${this.entries.length - local})`);
    }
    return this.entries.length;
  }

  private poolClosed(): boolean {
    return this.neverMuted && this.unlockSilent && !this.poolOpened;
  }

  /** Runde 30: die stillen Freischaltversuche der ersten Geste sind entschieden (oder die Frist ist um): der Vorrat beginnt zu laden */
  private openPool() {
    if (this.poolOpened || !this.gestSeen) return;
    this.poolOpened = true;
    this.diag('deck: pool start after unlock');
    this.refillDeferred();
  }

  /** Der aktive Moment spielt noch nicht: kein playing und weniger als readyState 3. Ohne aktiven Ausschnitt zählt er nur, wenn der Host einen erwartet (activePending, Kaltstart). */
  private activeBusy(activePending: boolean): boolean {
    if (this.live) return false;
    if (this.clip && !this.done) return (this.el?.readyState ?? 0) < 3;
    return activePending;
  }

  /** Zurückgestellte Vorlade-Abrufe nachholen (aktiver Moment spielt, oder die Frist ist um) */
  private refillDeferred() {
    const l = this.lastFill;
    if (!l || this.hidden()) return;
    this.fill(l.clips, l.locOf, l.activePending);
  }

  /** Einen Ausschnitt in ein freies Element laden (aus dem Vorrat lokal bevorzugt, sonst Netz). Nur sichtbar aufgerufen. */
  private startEntry(clip: DeckClip, loc: LocalClip | undefined, forcePlain = false): PoolEntry {
    // Spurwahl wie beim Start: die Lautheit hängt am Element, das später aktiv wird
    const pick = this.deps.lane?.(clip, !!loc, forcePlain) ?? { lane: 'plain' as const, why: 'no value' };
    let lane = pick.lane;
    let why = forcePlain && !pick.why ? 'fallback' : pick.why;
    let el = this.spare(lane);
    let chain: { linear: () => number } | null = null;
    if (lane === 'level') {
      chain = this.deps.chain?.(el, clip.gain ?? 0) ?? null;
      if (!chain) {
        lane = 'plain';
        why = 'no audio graph';
        el = this.spare('plain');
      }
    }
    const offset = loc?.offset ?? 0;
    const target = Math.max(0, clip.start - offset);
    const s: PoolEntry = { clip, el, lane, why, chain, local: !!loc, offset, target, meta: false, cpt: false, ready: false, rsAtReady: 0, thin: false, t0: Date.now() };
    this.entries.push(s);
    this.diag(`deck: pool load ${clip.id} src=${loc ? 'local' : 'net'}`);
    // Runde 24: ohne Medienfragment, die Position setzt currentTime (hier, nach den Metadaten in checkEntry)
    this.markLoad(el);
    el.src = loc?.url ?? clip.url;
    el.load();
    // load() setzt das Tempo zurück: Standard und aktuelles Tempo gemeinsam setzen
    this.applyRate(el);
    try {
      // iOS setzt die Position erst nach loadedmetadata, dort folgt der zweite Versuch
      if (target > 0) el.currentTime = target;
    } catch {
      /* nach loadedmetadata */
    }
    // Brief 22: nach 8 s ohne Bereitschaft nur eine Zeile, der Eintrag bleibt. Er fällt erst heraus, wenn er das Fenster verlässt oder ein Fehler-Ereignis kommt.
    setTimeout(() => {
      if (this.entries.includes(s) && !s.ready) {
        s.slow = true;
        this.diag(`deck: pool slow ${clip.id} 8000 ms rs=${el.readyState} meta=${s.meta}`);
        // Runde 18: ein langsamer Abruf des Vorrats macht das Netz schwach (nur Netz, lokale Quellen kommen nie hierher)
        // Runde 26: nicht, wenn das Element Daten hat (readyState 3 oder mehr): dann ist nur der Puffer hinter der Startstelle dünn, das Netz antwortet (Diag 19.11. 09:16:24, rs=4 meta=true)
        if (!s.local && el.readyState < 3) this.markWeak();
      }
    }, 8000);
    this.checkEntry(s);
    return s;
  }

  /** Runde 27: einmal je Sitzung, wenn alle Elemente einer Spur freigeschaltet sind */
  private noteAllUnlocked() {
    if (this.allNoted) return;
    for (const lane of ['plain', 'level'] as const) {
      const l = this.pool[lane];
      if (l.length >= POOL + 1 && l.every((e) => this.unlockedEls.has(e))) {
        this.allNoted = true;
        this.diag(`deck: all unlocked ${l.length}/${l.length} after ${Date.now() - this.t0} ms`);
        return;
      }
    }
  }

  /** Runde 20: Eintrag erfüllt die alte Bedingung, aber hinter der Startstelle liegt zu wenig Puffer. Einmal je Eintrag eine Zeile, nach POOL_NUDGE_MS einmal der Seek erneut. */
  private thinEntry(s: PoolEntry, rs: number) {
    if (s.thin) return;
    s.thin = true;
    const el = s.el;
    const dur = Number.isFinite(el.duration) ? el.duration.toFixed(1) : String(el.duration);
    this.diag(`deck: pool not ready yet ${s.clip.id} rs=${rs} dur=${dur} target=${s.target.toFixed(1)} buf=${this.bufText(el, s.target)}`);
    setTimeout(() => {
      if (!this.entries.includes(s) || s.ready || this.hidden()) return;
      try {
        // Ein Seek löst auf iOS den Abruf des Bereichs aus, ohne die Quelle neu zu setzen
        el.currentTime = s.target;
      } catch {
        /* iOS lehnt die Position ab */
      }
      this.diag(`deck: pool nudge ${s.clip.id} buf=${this.bufText(el, s.target)}`);
      this.checkEntry(s);
    }, POOL_NUDGE_MS);
  }

  /** Metadaten da, Position gesetzt, genug Daten zum Durchspielen: der Eintrag ist bereit */
  private checkEntry(s: PoolEntry) {
    if (s.ready || !s.meta || !this.entries.includes(s)) return;
    const el = s.el;
    try {
      if (Math.abs(el.currentTime - s.target) > SEEK_TOL) {
        el.currentTime = s.target;
        // Nach dem Springen zählt erst ein canplaythrough, das danach kommt
        s.cpt = false;
      }
    } catch {
      /* iOS lehnt die Position ab, solange keine Metadaten da sind */
    }
    // Runde 20: ein Seek läuft noch, readyState und Puffer sind erst nach seeked verlässlich (seeked ruft checkEntry erneut)
    if (el.seeking) return;
    if (Math.abs(el.currentTime - s.target) > SEEK_TOL) return;
    const rs = el.readyState;
    if (!(s.cpt || rs >= 4 || (s.local && rs >= 3))) return;
    // Runde 20: bereit erst, wenn hinter der Startstelle Daten liegen (duration gleich Startstelle meldet iOS bei teilweise geladenen Elementen)
    if (!poolEntryReady({ rs, target: s.target, dur: el.duration, buffered: el.buffered })) {
      this.thinEntry(s, rs);
      return;
    }
    s.ready = true;
    s.rsAtReady = rs;
    this.fails.delete(s.clip.key);
    // Der Host steht dabei: Max' Diag zeigt so, welche Quelle langsam lädt (Runde 8, Barbell 2 bis 5 s bis zum ersten Byte, Iron Culture 0,6 s)
    this.diag(`deck: pool ready ${s.clip.id} after ${Date.now() - s.t0} ms host=${s.local ? 'local' : hostOf(s.clip.url)}`);
    // Nach einem Tausch oder Verwerfen ist der Vorrat wieder voll
    if (this.depleted && this.entries.every((x) => this.usable(x))) {
      this.depleted = false;
      this.diag(`deck: pool refill ${this.entries.length}/${POOL}`);
    }
    // Brief 22: der Host erfährt jede neue Bereitschaft (Zeile "pool n/5 ready", vorgemerktes Weiter)
    try {
      this.onReady?.(this.readyCount());
    } catch (e) {
      this.diag(`deck onReady failed ${e instanceof Error ? e.message : String(e)}`);
    }
    // Runde 26: ein schneller Abruf zählt für ein gutes Netz
    if (!s.local) this.noteFast(Date.now() - s.t0, WEAK_OK_READY_MS, 'pool ready');
    // Runde 18: ein Abruf ist fertig, der nächste zurückgestellte darf starten
    if (this.deferNoted && !this.inFill) this.refillDeferred();
  }

  /** Die Quelle eines Eintrags lud nicht: aus dem Vorrat einmal vom Netz, in der geregelten Spur einmal unverändert. Sichtbar füllt der Host neu. */
  private entryError(e: PoolEntry) {
    this.diag(`deck: pool failed ${e.clip.id} (${e.local ? 'local' : e.lane})`);
    const { clip, local, lane } = e;
    // Runde 18: Fehler je Ausschnitt zählen (Netz), im schwachen Netz lädt er erst nach RELOAD_WAIT_MS neu (reloadGate in fill)
    if (!local) this.fails.set(clip.key, { n: (this.fails.get(clip.key)?.n ?? 0) + 1, at: Date.now() });
    this.dropEntry(e, 'error');
    this.depleted = true;
    if (local) this.deps.dropLocal(clip.key);
    else if (lane === 'level') this.deps.host?.(clip.url, 'bad');
    if (!this.hidden()) this.onNeedFill?.();
  }

  /** iOS hat das Element verworfen (readyState fiel auf 0): der Eintrag fällt aus dem Vorrat, der nächste sichtbare fill lädt ihn neu */
  private evict(e: PoolEntry) {
    this.diag(`deck: pool evicted ${e.clip.id}`);
    this.depleted = true;
    this.dropEntry(e, 'evicted');
  }

  /** Eintrag aus dem Vorrat nehmen. Das Element bleibt, wie es ist (pausiert, Quelle bleibt bis zur nächsten Befüllung). Sichtbar wird die Quelle freigegeben, verdeckt nie (kein load()). */
  private dropEntry(e: PoolEntry, why: string) {
    this.entries = this.entries.filter((x) => x !== e);
    this.kept = this.kept.filter((x) => x !== e);
    this.diag(`deck: pool dropped ${e.clip.id} (${why})`);
    if (!this.hidden()) this.clearSrc(e.el);
  }

  /**
   * Weiter ohne Quellwechsel (Schritt 1): das erste bereite Element in Reihenfolge der Warteschlange wird aktiv, play() läuft synchron auf ihm (im Call-Stack
   * des Handlers), danach hält das alte Element an und geht frei in den Vorrat zurück. Nichts wird geladen. Gibt den Ausschnitt zurück, der jetzt spielt.
   * null, wenn kein Element bereit ist: dann geschieht nichts.
   * Verdeckt (Brief 14b, Schritt 3) gilt eine andere Reihenfolge: lokale Elemente mit readyState 4 zuerst, dann die übrigen lokalen, Netz-Elemente nur, wenn
   * kein lokales bereit ist. iOS kann ein Netz-Element verdeckt trotz readyState 4 verwerfen, ein lokales nicht. Innerhalb jeder Stufe gilt die Warteschlange.
   */
  swapNext(sink: DeckSink | null = null): DeckClip | null {
    const hid = this.hidden();
    const tier = (e: PoolEntry) => (!hid ? 0 : e.local ? (e.el.readyState >= 4 ? 0 : 1) : 2);
    const order = this.entries.map((e, i) => ({ e, i })).sort((a, b) => tier(a.e) - tier(b.e) || a.i - b.i);
    for (const { e } of order) {
      if (!e.ready) continue;
      if (!this.usable(e)) {
        // Verworfen, seit es bereit wurde: nicht abspielbar
        this.evict(e);
        continue;
      }
      // iOS hat den Web-Audio-Kontext unterbrochen: die geregelte Spur wäre stumm. Dieser Eintrag taugt nicht, der nächste vielleicht.
      if (e.lane === 'level' && this.deps.running && !this.deps.running()) {
        this.diag(`deck: swap ${e.clip.id} ready=false (context not running)`);
        this.depleted = true;
        this.dropEntry(e, 'context not running');
        continue;
      }
      return this.swapEntry(e, sink);
    }
    this.diag('deck: swap none ready=false pool=0');
    return null;
  }

  /**
   * Hänge-Überwachung (Brief 14b, Entscheidung 45, Issue 40): ein Moment spielt nach 12 s nicht an. Sichtbar darf die App ihn überspringen (skip, er bleibt
   * ungesehen). Verdeckt nie: ist ein anderes Element des Vorrats bereit, tauscht die App darauf (swap, swapNext), sonst bleibt alles stehen (stay).
   */
  hungAction(): 'skip' | 'swap' | 'stay' {
    if (!this.hidden()) return 'skip';
    return this.entries.some((e) => this.usable(e)) ? 'swap' : 'stay';
  }

  /**
   * Tausch auf den Eintrag mit diesem Schlüssel (Wisch auf einen Moment, den der Vorrat hält). Runde 12: auch ein Eintrag, der noch lädt, wird übernommen
   * (siehe adopt). false nur bei Fehler, verworfenem Element oder nicht mehr passender Spur, dann lädt der Aufrufer neu.
   */
  private swapKey(key: string, sink: DeckSink | null): boolean {
    const e = this.entries.find((x) => x.clip.key === key) ?? this.kept.find((x) => x.clip.key === key);
    if (!e) return false;
    return this.adopt(e, true, false, e.clip.start, sink);
  }

  /**
   * Eintrag des Vorrats für den Start dieses Ausschnitts übernehmen, bereit oder nicht. Gründe für false (der Eintrag fällt dann heraus, der Start lädt neu):
   * - Fehler im Element (error)
   * - iOS hat das Element verworfen (war bereit, readyState jetzt 0)
   * - die geregelte Spur, aber der Web-Audio-Kontext läuft nicht, oder der Start verlangt die unveränderte Spur (forcePlain)
   * Spur, Kette und Anpassung der Lautheit kommen mit dem Eintrag (swapEntry). iOS: das play() läuft auf dem Element des Eintrags. Hat es keine Freigabe und
   * kommt der Aufruf nicht aus einer Geste, lehnt iOS ab (NotAllowedError), dann zeigt der Host die Tippfläche und der Tipp startet es (unlock, kick).
   */
  private adopt(e: PoolEntry, play: boolean, forcePlain: boolean, from: number, sink?: DeckSink | null): boolean {
    if (e.el.error) {
      this.dropEntry(e, 'error');
      return false;
    }
    if (e.ready && !this.usable(e)) {
      this.evict(e);
      return false;
    }
    if (e.lane === 'level' && (forcePlain || (this.deps.running && !this.deps.running()))) {
      this.diag(`deck: swap ${e.clip.id} ready=false (${forcePlain ? 'plain lane required' : 'context not running'})`);
      this.depleted = true;
      this.dropEntry(e, forcePlain ? 'plain lane required' : 'context not running');
      return false;
    }
    this.swapEntry(e, sink ?? null, { keepSink: sink === undefined, play, from });
    return true;
  }

  private swapEntry(s: PoolEntry, sink: DeckSink | null, via?: { keepSink: boolean; play: boolean; from: number }): DeckClip {
    const old = this.el;
    const clip = s.clip;
    const el = s.el;
    const play = via?.play ?? true;
    // Runde 26: der verlassene Moment, bevor die Felder des aktiven Moments überschrieben werden
    const prev = old && old !== el ? this.snapActive() : null;
    const fromKept = this.kept.includes(s);
    this.noteDur(el, clip.key);
    this.entries = this.entries.filter((x) => x !== s);
    this.kept = this.kept.filter((x) => x !== s);
    this.coldNet = false;
    this.depleted = true;
    this.releaseHold();
    if (old && !this.neverMuted) el.muted = old.muted;
    this.el = el;
    this.lane = s.lane;
    this.loudLinear = s.chain ? s.chain.linear : null;
    this.loudInfo = s.chain ? { db: clip.gain ?? 0, how: 'web audio' } : { db: 0, how: `unchanged: ${s.why}` };
    this.holding = null;
    this.holdToken++;
    this.noteClip(clip.key, true);
    this.armed = s.meta || s.ready;
    this.clip = clip;
    this.done = false;
    this.nudged = false;
    this.live = false;
    this.played = false;
    this.resetEarly();
    this.want = play;
    this.inflightAt = 0;
    this.kickTok++;
    this.skipNoted = false;
    this.needTapKey = '';
    this.offset = s.offset;
    this.isLocal = s.local;
    // Ein Start ab anderer Stelle (Wiederaufnahme) setzt die Position des Eintrags neu
    const from = via?.from ?? clip.start;
    this.resumeFrom = from;
    this.target = from === clip.start ? s.target : Math.max(0, from - s.offset);
    if (fromKept) {
      // Runde 26: zurück auf einen behaltenen Moment: Start an der Startstelle des Moments, nicht dort, wo er verlassen wurde
      this.diag(`deck: swap back ${clip.id} from kept`);
      try {
        if (Math.abs(el.currentTime - this.target) > SEEK_TOL / 2) el.currentTime = this.target;
      } catch {
        /* nach loadedmetadata */
      }
    }
    this.history.push(clip.key);
    if (this.history.length > 200) this.history.shift();
    this.snd = { muted: isSilent(this.soundView(el)), playing: false, refused: false };
    // Der alte Player gibt ab (wie beim automatischen Weiter), der neue übernimmt später über load(), das den laufenden Ausschnitt erkennt (holds)
    // Der Sink steht vor dem play(): ein Element meldet "playing" auch synchron, der neue Player soll den Zustand nie verpassen
    if (!via?.keepSink) this.sink = sink;
    this.applyRate(el);
    if (s.ready) {
      this.diag(`deck: swap ${clip.id} ready=true pool=${this.readyCount()}`);
      // Runde 20: der Eintrag war bereit, hat hinter der Startstelle aber zu wenig Puffer: Zeile, getauscht wird trotzdem
      if (play && !poolEntryReady({ rs: el.readyState, target: this.target, dur: el.duration, buffered: el.buffered })) {
        const d = Number.isFinite(el.duration) ? el.duration.toFixed(1) : String(el.duration);
        this.diag(`deck: swap onto thin buffer ${clip.id} rs=${el.readyState} dur=${d} target=${this.target.toFixed(1)} buf=${this.bufText(el, this.target)}`);
      }
    } else {
      // Runde 12: der Eintrag lädt noch. Sein Element behält Quelle und Bytes, nach den Metadaten springt seek(true) an die Position (loadedmetadata, mine).
      this.diag(`deck: pool adopt ${clip.id} rs=${el.readyState} meta=${s.meta} after ${Date.now() - s.t0} ms`);
      if (s.meta) this.seek(true);
      this.loading(!s.local && el.readyState < 3);
    }
    // Runde 13: ein Element, das im Vorrat schon "ended" war, spielte sonst von vorn (play() am Ende springt auf 0)
    // Runde 22: auch bei von iOS gemeldeter duration gleich Startstelle (Ende gemeldet), die Position allein hebt ended dort nicht auf: Rückschritt
    let dodged = false;
    if (play && (el.ended || restartPos({ ended: false, dur: el.duration, at: this.target, startEl: clip.start - s.offset }) !== this.target)) {
      // Runde 27: Kollaps (Dauer gleich Position, echte Dauer oder Puffer weiter hinten): ein frisches Element statt Rückschritt am selben. Verdeckt nie (kein load()).
      const col = this.collapsed(el, clip);
      this.lastCol = { el, at: Date.now() };
      this.collapseLine(el, clip.id);
      dodged = col && this.dodgeOn && !this.hidden() && !this.isLocal && this.dodge(el, clip);
      if (!dodged) {
        const pos = restartPos({ ended: true, dur: el.duration, at: this.target, startEl: clip.start - s.offset });
        this.diag(`deck: swap at reported end ${clip.id} t=${this.target.toFixed(1)} dur=${Number.isFinite(el.duration) ? el.duration.toFixed(1) : String(el.duration)}, stepping back`);
        try {
          el.currentTime = pos;
        } catch {
          /* nach loadedmetadata */
        }
      }
    }
    // Runde 20: gar kein Puffer hinter der Stelle: Wächter vor dem play(), damit auch ein sofortiges "playing" nur als Laden erscheint
    const starve = !dodged && play && !this.aheadOk(el);
    if (starve) this.guard = el;
    // Runde 24: stumm bis die Position bestätigt ist (Quelle ohne Fragment, aber iOS meldete beim Tausch ein Ende an der Startstelle)
    if (!dodged && (s.meta || s.ready)) this.posSetLine(el);
    if (!dodged && play) this.beginPosHold(el, clip);
    if (!dodged && play) this.playAfterJump(el, clip, 'swap', s.ready && this.target === s.target);
    if (starve) this.showLoading();
    // Das alte Element geht frei in den Vorrat zurück: pausiert, Quelle bleibt bis zur nächsten Befüllung (kein load() verdeckt)
    if (old && old !== el) {
      this.halt(old, 'app: swap');
      if (prev) this.addKept(prev);
    }
    if (play) this.deps.playbackState?.('playing', 'swap');
    return clip;
  }

  private rejected(e: unknown, why: string) {
    const name = e instanceof Error ? e.name : String((e as { name?: string } | null)?.name ?? e);
    // Ein neuer Quellwechsel bricht das alte play() ab, das ist kein Fehler
    if (name === 'AbortError') return;
    const c = this.clip;
    // Die geregelte Spur ist nie entsperrt worden: auf die unveränderte wechseln, die den bewährten Weg hat
    if (name === 'NotAllowedError' && this.lane === 'level' && c && !this.done) {
      this.diag(`loud: level lane refused ${name}, playing unchanged`);
      this.bail('play refused');
      return;
    }
    if (name === 'NotAllowedError' && this.el) {
      this.snd = reduceSound(this.snd, 'refused', this.soundView(this.el));
      this.sink?.sound?.();
    }
    if (c && this.refusedKey !== c.key) {
      this.refusedKey = c.key;
      this.diag(`bg: play rejected ${name}`);
    }
    this.diag(`deck play refused ${name} (${why}) ${c?.id ?? ''}`);
    // Abgelehnt heißt: dieses Element hat keine Freigabe. Ein Anstoß im Ereignis pointerdown (unlock) ist kein Anlass für die Tippfläche, der Tipp folgt gleich mit pointerup.
    if (name === 'NotAllowedError') {
      if (this.el) {
        this.unlockedEls.delete(this.el);
        this.unlockWho.delete(this.el);
      }
      const soft = why === 'unlock' && this.lastGesture === 'pointerdown';
      // Verdeckt abgelehnt (iOS im Hintergrund) ist kein Fall für die Tippfläche: bei der Rückkehr startet die App von selbst, erst eine Ablehnung im Sichtbaren verlangt den Tipp
      if (c && !soft && !this.hidden()) {
        this.needTapKey = c.key;
        this.needTapNoted = false;
        this.diag(`audio: needs tap ${c.id} (${why})`);
        try {
          this.onRefused?.(c.id, why);
        } catch (err) {
          this.diag(`deck onRefused failed ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    // Kein Stopp-Zeitgeber: der Zustand ist Pause, bei der Rückkehr startet die App den Ton sofort wieder
    this.sink?.state(PAUSED);
  }

  /** Von der geregelten Spur zurück auf die unveränderte, an der aktuellen Stelle */
  private bail(why: string) {
    const c = this.clip;
    const el = this.el;
    if (!c || !el || this.done || this.lane !== 'level') return;
    this.diag(`loud: level lane abandoned (${why}), playing unchanged`);
    const at = el.currentTime + this.offset;
    this.start(c, this.want || !el.paused, true, Math.max(c.start, at), why);
  }

  /**
   * Erste Berührung (Entscheidung 16): Läuft der Ausschnitt schon unverändert, weil es noch keinen Kontext gab, wird er jetzt an die geregelte Spur
   * gehängt, an der aktuellen Stelle. Ein Element lässt sich nicht nachträglich an Web Audio hängen (es braucht CORS von Anfang an), darum ein
   * Quellwechsel mit kurzer Lücke. Das geschieht vor dem Ton (die Berührung schaltet ihn erst frei) und nur, wenn die Spur sicher ist.
   */
  relevel(skipWait = false): boolean {
    const c = this.clip;
    const el = this.el;
    if (!c || !el || this.done || this.lane !== 'plain' || this.loudInfo.how !== 'unchanged: no audio context') return false;
    const pick = this.deps.lane?.(c, this.isLocal, false);
    if (!pick || pick.lane !== 'level') return false;
    // Runde 9: steht das Urteil der Probe für den Host noch aus, kein Versuch mit Rückfall: kurz warten, dann neu entscheiden (nie ein zweites Mal warten)
    const wait = skipWait ? null : this.deps.settle?.(c, false) ?? null;
    if (wait) {
      if (this.relevelWait) return false;
      this.relevelWait = true;
      this.diag(`loud: relevel ${c.id} waits for host check`);
      void wait.then(() => {
        this.relevelWait = false;
        if (this.clip === c && !this.done && this.lane === 'plain' && this.loudInfo.how === 'unchanged: no audio context') this.relevel(true);
      });
      return false;
    }
    const at = el.currentTime + this.offset;
    if (c.end !== undefined && c.end - at < RELEVEL_MIN_LEFT) return false;
    this.diag(`loud: attaching running clip at ${at.toFixed(1)} s (${pick.why})`);
    this.start(c, this.want || !el.paused, false, Math.max(c.start, at));
    return true;
  }

  /**
   * Zustand des Web-Audio-Kontexts hat sich geändert (iOS unterbricht ihn bei gesperrtem Bildschirm, Anruf). Läuft er nach kurzer Frist nicht
   * mehr, ist die geregelte Spur stumm: zurück auf die unveränderte, an der aktuellen Stelle. Der Wechsel braucht Zeit zum Laden, eine Lücke
   * von dieser Länge bleibt (das unveränderte Element ist durch die Geste freigeschaltet und darf im Hintergrund starten).
   */
  contextChanged(state: string) {
    if (state === 'running') return;
    window.setTimeout(() => {
      const el = this.el;
      if (this.lane === 'level' && !this.done && el && !el.paused && !this.deps.running?.()) {
        this.deps.broken?.(`context ${state}`);
        this.bail(`context ${state}`);
      }
    }, CONTEXT_GRACE_MS);
  }

  /**
   * Ende des Ausschnitts (timeupdate oder ended), höchstens einmal je Ausschnitt. Verdeckt tauscht das Deck auf das nächste bereite Element des Vorrats
   * (Schritt 4), im selben Handler, nie mit einem Quellwechsel am Element. Ist keins bereit, hält das Element an und meldet das Ende.
   */
  private clipEnd(why: string) {
    const el = this.el;
    const c = this.clip;
    if (!el || !c || this.done) return;
    this.done = true;
    const hid = this.hidden();
    if (hid) this.hiddenStats.ends++;
    const ready = this.readyCount();
    const go = !!(this.onAdvance && hid && ready > 0);
    this.note(`clip end via ${why} hidden=${hid} pool=${ready} onAdvance=${!!this.onAdvance} advance=${go ? 'yes' : 'no'} ${this.stateText(el)}`);
    if (go && this.onAdvance) {
      // Hintergrund: Tausch und play() im selben Handler. Erst danach die Buchführung der App.
      const from = c;
      const to = this.swapNext(null);
      if (to) {
        this.note(`advance ${from.id} to ${to.id}: swap and play() in this handler, new element ${this.el !== el}, next from storage ${this.isLocal}, readyState ${this.el?.readyState ?? '?'}`);
        this.adv = { to: to.id, t0: Date.now() };
        setTimeout(() => {
          if (this.adv?.to !== to.id) return;
          this.adv = null;
          if (this.el) this.note(`advance to ${to.id}: NOT playing after 3 s, ${this.stateText(this.el)} error ${this.el.error?.code ?? 'none'}`);
        }, 3000);
        try {
          this.onAdvance(from, to);
        } catch (e) {
          this.diag(`deck onAdvance failed ${e instanceof Error ? e.message : String(e)}`);
        }
        return;
      }
    }
    // Vordergrund oder kein bereites Element: anhalten und das Ende melden, die App entscheidet (Für-dich-Karte, Wisch)
    if (hid) this.diag(`bg: end without switch ${c.id} (pool ${ready}, onAdvance ${this.onAdvance ? 'yes' : 'no'}), element stops`);
    this.halt(el, 'app: clip end');
    this.sink?.state(ENDED);
  }

  /** Aufräumen, wenn der Audio-Reiter verlassen wird: Ton aus, keine Rückrufe */
  release() {
    this.endWait();
    this.endJump();
    this.holdToken++;
    this.holding = null;
    this.resetEarly();
    this.loading(false);
    this.onStart = null;
    this.onLoading = null;
    this.pending = null;
    this.onAdvance = null;
    this.onMedia = null;
    this.onPlayed = null;
    this.onNeedFill = null;
    this.onReady = null;
    this.onRefused = null;
    this.needTapKey = '';
    this.diag = () => {};
    this.entries = [];
    this.kept = [];
    this.weakFast = 0;
    this.depleted = false;
    if (this.deferTimer) clearTimeout(this.deferTimer);
    this.deferTimer = null;
    this.deferNoted = false;
    this.lastFill = null;
    if (this.weakTimer) clearTimeout(this.weakTimer);
    this.weakTimer = null;
    this.weakUntil = 0;
    this.fails.clear();
    this.sink = null;
    this.want = false;
    this.done = true;
    for (const e of this.all()) {
      this.halt(e, 'app: release');
      this.clearSrc(e);
    }
  }

  /** Quelle freigeben (höchstens 3 Medien-Elemente mit Quelle). Nur über removeAttribute, ein leeres src löst einen Fehler aus. */
  private clearSrc(el: DeckEl) {
    try {
      el.pause();
      if (el.removeAttribute) {
        el.removeAttribute('src');
        el.load();
      }
    } catch {
      /* Element schon weg */
    }
  }

  // ---- Schnittstelle für die Player ----

  owns(sink: DeckSink): boolean {
    return this.sink === sink;
  }

  /** Läuft dieser Ausschnitt gerade im Element (und ist nicht zu Ende)? */
  holds(key: string): boolean {
    return !!this.el && this.clip?.key === key && !this.done;
  }

  /** Ausschnitt laden und spielen (oder, wenn er schon im Element läuft, nur den Besitz übernehmen) */
  load(clip: DeckClip, sink: DeckSink, opts: { play: boolean; muted: boolean }) {
    const el = this.element;
    this.sink = sink;
    this.applyMuted(el, opts.muted);
    if (this.holds(clip.key) && el.src) {
      this.want = opts.play;
      if (opts.play) {
        if (el.paused) this.kick('resume');
        else if (this.live) sink.state(PLAYING);
      } else this.halt(el, 'app: load without play');
      return;
    }
    // Wisch auf einen Moment, den der Vorrat fertig hält: Rollen tauschen statt die Quelle zu wechseln (Brief 11, Schritt 4)
    if (opts.play && this.swapKey(clip.key, sink)) {
      if (this.el) this.applyMuted(this.el, opts.muted);
      return;
    }
    this.start(clip, opts.play);
  }

  /** Weiterspielen, wo der Ausschnitt steht */
  play(sink: DeckSink) {
    if (this.sink !== sink || !this.clip) return;
    this.want = true;
    if (this.done) return;
    this.kick('play');
  }

  pause(sink: DeckSink) {
    if (this.sink !== sink || !this.el) return;
    this.want = false;
    this.halt(this.el, 'app: pause (user, media key or lock screen)');
  }

  /** Dieser Player gibt das Element frei (destroy) */
  drop(sink: DeckSink) {
    if (this.sink !== sink) return;
    this.sink = null;
    this.want = false;
    if (this.el) this.halt(this.el, 'app: drop');
  }

  setMuted(sink: DeckSink, muted: boolean) {
    if (this.sink !== sink || !this.el) return;
    const was = this.soundOff;
    this.applyMuted(this.el, muted);
    if (!this.neverMuted || was === muted) return;
    const el = this.el;
    if (muted) {
      // Ton aus: nicht stumm weiterspielen, anhalten und auf den Tipp warten (Wunsch zu spielen bleibt)
      if (!el.paused && this.clip && !this.done) this.halt(el, 'app: sound off');
    } else if (this.want && el.paused && this.clip && !this.done) this.kick('unmute');
  }

  /** Tempo gilt für das eine Element, egal welcher Player es setzt */
  setRate(rate: number) {
    this.rate = rate;
    for (const e of this.all()) this.applyRate(e);
    // Tempo ungleich 1x nie über Web Audio (Issue 13): ein laufender Ausschnitt auf der geregelten Spur wechselt an der Stelle auf die unveränderte
    const before = this.el;
    if (rate !== 1) this.bail('tempo');
    // Cue-Uhr und Sperrbildschirm sofort mit dem neuen Tempo versorgen, nicht erst beim nächsten timeupdate (Issue 15). Bei Spurwechsel hält start() die Zeit.
    if (this.el && this.el === before && this.clip && !this.done) this.tick(this.el);
  }

  /** Nur schreiben, was abweicht: unnötige Schreibzugriffe auf playbackRate lassen WebKit mit aktiver Media Session abstürzen (im Testrunner beobachtet) */
  private applyRate(el: DeckEl) {
    // Ein Element ohne Quelle bleibt unberührt
    if (!el.src) return;
    if (el.preservesPitch === false) el.preservesPitch = true;
    if (el.defaultPlaybackRate !== this.rate) el.defaultPlaybackRate = this.rate;
    if (el.playbackRate !== this.rate) el.playbackRate = this.rate;
  }

  /** Ton und Wiedergabe des Elements, solange dieser Player es besitzt (Hinweis "Ton aus") */
  sound(sink: DeckSink): SoundObs | null {
    return this.sink === sink && this.el ? this.snd : null;
  }

  /** Lautheit, die auf dem laufenden Ausschnitt wirklich angewendet ist (Diagnose, Tests) */
  loud(sink: DeckSink): { db: number; how: string; linear?: number } | null {
    if (this.sink !== sink) return null;
    return this.loudLinear ? { ...this.loudInfo, linear: this.loudLinear() } : { ...this.loudInfo };
  }

  /** Erste Berührung: das Element der geregelten Spur einmal mit Stille starten, damit iOS ihm später auch im Hintergrund Ton erlaubt */
  prime() {
    if (this.levelPrimed || !this.deps.lane) return;
    this.levelPrimed = true;
    // Mit Vorrat gibt es POOL + 1 Elemente der geregelten Spur: alle müssen die Geste gesehen haben, sonst startet ein Tausch verdeckt nicht
    this.ensureCount('level', this.deps.standby ? POOL + 1 : 1);
    for (const el of this.pool.level) this.silentPlay(el);
  }

  /**
   * Freischaltversuch auf einem Element, solange eine Geste läuft. Stumm gestartet, erst nach erfülltem play() angehalten (ein sofort abgebrochenes play() schaltet auf iOS
   * vermutlich nichts frei). Ein Element gilt erst als freigeschaltet, wenn das play() wirklich angenommen wurde. Bis dahin versucht es jede weitere Geste erneut.
   * Danach: Stummschaltung zurück, Element anhalten (nie das aktive), ein Eintrag des Vorrats behält Quelle und Position, ein freies Element gibt die Quelle frei.
   * Runde 29 (UNLOCK_SILENT): nie auf einer Netzquelle, nur auf Elementen ohne Quelle (stille Inline-Quelle). Gibt zurück, ob ein Versuch gestartet wurde.
   */
  private probe(el: DeckEl, done?: (ok: boolean) => void): boolean {
    if (el === this.el || this.unlockedEls.has(el)) return false;
    // Ein Versuch ist unterwegs: kein zweiter (ein abgelehnter ist nach Millisekunden entschieden, der Tipp bringt pointerup, touchend und click kurz nacheinander)
    if (this.probes.has(el)) return false;
    if ((this.unlockSilent || this.neverMuted) && !this.silentEl(el)) return false;
    const r = { n: 1, muted: el.muted };
    this.probes.set(el, r);
    this.st(el).probed = true;
    this.diag(`deck: probe ${this.idOf(el)} at t=${this.num(el.currentTime)} rs=${el.readyState} dur=${this.num(el.duration)}`);
    const gid = this.gid;
    const type = this.lastGesture;
    this.gestureOpen.set(gid, (this.gestureOpen.get(gid) ?? 0) + 1);
    let inline = false;
    const settle = (ok: boolean) => {
      if (ok) {
        if (!this.unlockedEls.has(el)) this.unlockWho.set(el, inline ? 'silent' : 'probe');
        this.unlockedEls.add(el);
        this.noteAllUnlocked();
      }
      r.n--;
      if (r.n <= 0 && this.probes.get(el) === r) {
        this.probes.delete(el);
        this.diag(`deck: probe done ${this.idOf(el)} ok=${ok ? 1 : 0} dur=${this.num(el.duration)} t=${this.num(el.currentTime)}`);
        if (el !== this.el) {
          const e = this.entryOf(el);
          try {
            // Ein Eintrag oder ein behaltenes Element, das während der Probe eine Netzquelle bekam, bleibt unberührt (kein halt, keine Position)
            const mine = !inline || el.src === SILENT;
            if (mine && !el.paused) this.halt(el, 'app: gesture unlock');
            if (mine) el.muted = r.muted;
            if (e) {
              // Die Position bleibt am Start des Ausschnitts (checkEntry zieht bei größerer Abweichung nach)
              if (mine && e.ready && Math.abs(el.currentTime - e.target) > SEEK_TOL / 2) el.currentTime = e.target;
            } else if (mine && !this.keptOf(el)) this.clearSrc(el);
          } catch {
            /* Element schon weg */
          }
        }
      }
      done?.(ok);
      const open = (this.gestureOpen.get(gid) ?? 1) - 1;
      this.gestureOpen.set(gid, open);
      // Kurz warten: das play() des aktiven Elements (unlock) endet im selben Atemzug und soll in der Zahl stehen
      if (open <= 0) setTimeout(() => this.unlockLine(gid, type), 50);
    };
    setTimeout(() => this.unlockLine(gid, type), UNLOCK_LINE_MS);
    try {
      el.muted = true;
      if (!this.entryOf(el) && !el.src) el.src = SILENT;
      inline = !!el.src && el.src.startsWith('data:');
      const p = el.play();
      if (p === undefined) settle(true);
      else
        p.then(
          () => settle(true),
          () => settle(false),
        );
    } catch {
      settle(false);
    }
    return true;
  }

  /** Runde 29: das Element trägt keine Netzquelle (keine Quelle oder die stille Inline-Quelle) */
  private silentEl(el: DeckEl): boolean {
    return !el.src || el.src.startsWith('data:');
  }

  /** Eine Zeile je Geste, und nur wenn sich die Zahl der freigeschalteten Elemente geändert hat: zeigt Max' Diag, welches Ereignis freischaltet */
  private unlockLine(gid: number, type: string) {
    if (this.lineDone.has(gid)) return;
    this.lineDone.add(gid);
    if (this.lineDone.size > 50) this.lineDone.delete(this.lineDone.values().next().value as number);
    const all = this.all();
    const a = all.filter((e) => this.unlockedEls.has(e)).length;
    if (a === this.lastLoggedA) return;
    this.lastLoggedA = a;
    this.diag(`deck: gesture ${type} unlocked ${a}/${all.length}`);
  }

  /** Element mit Stille starten, solange eine Geste läuft. Aktive und Vorrats-Elemente bleiben unberührt (der Vorrat hat gesturePool), ein schon freigeschaltetes ebenso. */
  private silentPlay(el: DeckEl) {
    if (this.entryOf(el)) return;
    this.probe(el);
  }

  /** Mit Vorrat gibt es POOL + 1 Elemente der unveränderten Spur: alle per Geste freischalten (iOS erlaubt play() ohne Geste nur Elementen, die schon durch eine gespielt haben) */
  private unlockSpares() {
    this.ensureCount('plain', POOL + 1);
    if (this.unlockSilent) {
      this.silentUnlock();
      return;
    }
    for (const el of this.all()) this.silentPlay(el);
    this.gesturePool();
  }

  /**
   * Runde 29: jedes Element, das nicht freigeschaltet ist und keine Netzquelle trägt (frei oder neu angelegt), wird mit der stillen Inline-Quelle stumm angespielt, nach Annahme
   * pausiert, die Quelle wieder entfernt (probe, clearSrc). Elemente mit Netzquelle (aktiv, Vorrat, behalten) bleiben unberührt, sie schalten sich im Wisch frei (kick).
   * Ein freies Element mit einer übrig gebliebenen Netzquelle gibt sie vorher frei (sichtbar).
   */
  private silentUnlock() {
    let n = 0;
    let ok = 0;
    let open = 0;
    let looping = true;
    const t = Date.now();
    const finish = () => {
      if (looping || open > 0) return;
      if (n > 0) {
        const key = `${n}/${ok}`;
        if (key !== this.silentLast) {
          this.silentLast = key;
          this.diag(`deck: gesture unlock ${n} elements ok=${ok} after ${Date.now() - t} ms`);
        }
      }
      this.openPool();
    };
    for (const el of this.all()) {
      if (el === this.el || this.unlockedEls.has(el) || this.entryOf(el) || this.keptOf(el) || this.probes.has(el)) continue;
      if (!this.silentEl(el)) {
        if (this.hidden()) continue;
        this.clearSrc(el);
      }
      n++;
      open++;
      const started = this.probe(el, (good) => {
        open--;
        if (good) ok++;
        finish();
      });
      if (!started) {
        n--;
        open--;
      }
    }
    looping = false;
    finish();
  }

  /** Brief 22 (ohne UNLOCK_SILENT): der Vorrat füllt sich schon vor der ersten Geste, die Geste spielt jedes Element mit Quelle stumm an (probe), bis ein play() angenommen wurde. */
  private gesturePool() {
    for (const e of this.entries) this.probe(e.el);
  }

  time(sink: DeckSink): number | null {
    return this.sink === sink && this.el ? this.el.currentTime + this.offset : null;
  }

  duration(sink: DeckSink): number | null {
    return this.sink === sink && this.el ? (this.el.duration || 0) + this.offset : null;
  }

  local(sink: DeckSink): boolean {
    return this.sink === sink && this.isLocal;
  }

  /**
   * Seitenwechsel (visibilitychange hidden oder visible, pagehide, pageshow): Zustand des Elements und der Media Session ins Protokoll.
   * Bei hidden folgen Zeilen nach 1, 5 und 15 s, solange die Seite noch im Hintergrund steht (läuft die Zeit weiter, spielt das Element).
   * Bei visible eine Zeile mit den Ereignissen, die im Hintergrund kamen.
   */
  pageEvent(kind: string) {
    const el = this.el;
    if (!el) return;
    const line = (tag: string) => {
      const ms = typeof navigator !== 'undefined' && 'mediaSession' in navigator ? navigator.mediaSession.playbackState : 'n/a';
      const s = el.src ?? '';
      const src = !s ? 'none' : s.startsWith('data:') ? 'silence' : s.startsWith('blob:') ? 'storage' : 'net';
      return `page ${kind}${tag}: paused=${el.paused} ended=${el.ended} t=${el.currentTime.toFixed(1)} rs=${el.readyState} rate=${el.playbackRate} src=${src} lane=${this.lane} want=${this.want} done=${this.done} mediaSession=${ms}`;
    };
    this.note(line(''));
    if (kind === 'hidden') {
      this.hiddenStats = { tu: 0, ended: 0, ends: 0, plays: 0, at: Date.now() };
      for (const sec of [1, 5, 15]) setTimeout(() => this.hidden() && this.note(line(` +${sec} s`)), sec * 1000);
    } else if (kind === 'visible' && this.hiddenStats.at) {
      const h = this.hiddenStats;
      this.note(`while hidden ${Math.round((Date.now() - h.at) / 1000)} s: timeupdate ${h.tu}, ended ${h.ended}, clip ends ${h.ends}, play calls ${h.plays}`);
      this.hiddenStats.at = 0;
    }
  }

  /** Audio-Sitzung auf playback: Ton läuft auch bei gesperrtem Bildschirm und mit Stumm-Schalter (iOS 17 und neuer) */
  private session() {
    try {
      const s = typeof navigator !== 'undefined' ? (navigator as unknown as { audioSession?: { type: string } }).audioSession : undefined;
      if (s && s.type !== 'playback') {
        s.type = 'playback';
        this.diag(`bg: audioSession type ${s.type}`);
      }
    } catch {
      /* nicht unterstützt */
    }
  }

  /** Aus einer Geste heraus aufrufen: schaltet das Element für späteres play() ohne Geste frei. Wirkt nur einmal je Seite. */
  unlock(type = 'click') {
    this.noteEnv();
    this.session();
    this.gid++;
    this.gestAt = Date.now();
    this.lastGesture = type;
    if (ACTIVATING.has(type)) this.actAt = Date.now();
    if (ACTIVATING.has(type) && !this.gestSeen) {
      this.gestSeen = true;
      // Haken der Freischaltung: hängt ein Versuch, öffnet der Vorrat trotzdem
      if (this.deps.standby) setTimeout(() => this.openPool(), POOL_OPEN_MS);
    }
    if (this.deps.standby) this.unlockSpares();
    // Runde 30: ein Ausschnitt, der auf den Tipp wartet, startet mit der ersten aktivierenden Geste (auch wenn schon ein stilles play() angenommen wurde)
    if (this.neverMuted && this.waitTapKey && this.clip?.key === this.waitTapKey && !this.done && this.want && this.el?.paused && this.gestSeen && !this.soundOff) {
      this.kick('unlock');
      return;
    }
    if (this.unlocked) return;
    const el = this.ensure('plain');
    // Läuft oder wartet schon ein echter Ausschnitt, kommt die Freischaltung von dessen play(). Ein vom Menschen angehaltener bleibt angehalten.
    if (this.clip && !this.done) {
      // Jede Geste ruft unlock: nur anstoßen, was wirklich steht
      if (this.want && this.el?.paused) this.kick('unlock');
      return;
    }
    if (!el.src) el.src = SILENT;
    try {
      const p = el.play();
      p?.then?.(
        () => {
          this.unlocked = true;
          this.unlockedEls.add(el);
        },
        () => {},
      );
    } catch {
      /* ohne Geste nichts zu tun */
    }
  }

  /** Pausiert das aktive Element gerade (Diagnose "ready but not playing")? Ohne Element: true. */
  paused(): boolean {
    return this.el?.paused ?? true;
  }

  /** readyState des aktiven Elements (der Feed gibt einen Moment mit Daten nie als hängend auf) */
  readyState(): number {
    return this.el?.readyState ?? 0;
  }
}
