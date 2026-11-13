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

/** Läuft ein Ausschnitt schon unverändert und bleiben weniger Sekunden, lohnt der Wechsel auf die geregelte Spur nicht mehr */
const RELEVEL_MIN_LEFT = 4;
/** So lange nach einer Unterbrechung des Kontexts warten, bevor auf die unveränderte Spur gewechselt wird (iOS setzt ihn oft von selbst fort) */
const CONTEXT_GRACE_MS = 1500;

/** Wie lange der erste Start auf die Blob-URL aus dem Vorrat wartet, bevor er vom Netz kommt (ms, Kaltstart, Brief 02) */
const HOLD_MS = 1200;

/** So lange nach einem play() ohne Ergebnis hält der Deck weitere Anstöße (soundGuard, play des Feeds, canplay) vom selben Ausschnitt zurück, auch ohne Metadaten */
const KICK_INFLIGHT_MS = 1500;

/**
 * Issue 58: ein Ausschnitt bekommt genau einen Startversuch je Quelle. Solange das play() des Ausschnitts aussteht und noch keine Metadaten da sind (kalter Start,
 * Host liefert den späten Startpunkt langsam), oder es jünger als KICK_INFLIGHT_MS ist, tut jeder weitere Anstoß nichts. Max' Diag 11.11. zeigte play#4 bis #6
 * binnen 2 s auf demselben Ausschnitt. Ein neuer Ausschnitt (start, swap) ist nie betroffen.
 */
export function skipKick(s: { inflightAt: number; readyState: number }, now: number, why: string): boolean {
  if (why === 'start' || why === 'swap') return false;
  if (s.inflightAt <= 0) return false;
  return s.readyState < 1 || now - s.inflightAt < KICK_INFLIGHT_MS;
}

/** Ereignisse, in denen iOS ein play() annimmt (ein Tipp ohne Bewegung). pointerdown und das Ende eines Wischs gehören nicht dazu. */
const ACTIVATING = new Set(['pointerup', 'touchend', 'click', 'keydown']);
/** So lange nach einer solchen Geste (ms) darf ein Anstoß auch dann spielen, wenn die Tippfläche steht */
const GESTURE_WINDOW_MS = 120;
/** So lange wartet die Diag-Zeile "deck: gesture ... unlocked" auf die Ergebnisse der Freischaltung, bevor sie mit dem Stand schreibt (ms) */
const UNLOCK_LINE_MS = 800;

/** Null Sekunden Stille: schaltet das Element durch eine Geste frei, bevor der erste echte Moment kommt */
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

/** Größe des Element-Vorrats (Entscheidung 52, Brief 14): so viele nächste Momente liegen fertig geladen in eigenen Elementen, plus das aktive */
export const POOL = 5;

/** Aus so vielen nächsten Momenten wählt der Vorrat seine POOL Ausschnitte, lokale zuerst (Brief 14b, Entscheidung 45). Entspricht dem Fenster der Vorrats-Tiefe (3 der nächsten 6). */
export const POOL_WINDOW = 6;

/** Runde 12: solange der aktive Moment nicht spielt, startet der Vorrat höchstens einen Netz-Abruf. Danach alle FILL_DEFER_MS einen weiteren, auch ohne dass der aktive spielt. */
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
  t0: number;
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

export const withStart = (url: string, start: number): string => (start > 0 && !url.includes('#') ? `${url}#t=${start}` : url);

export class AudioDeck {
  /** Das aktive Element. Je Spur gibt es höchstens POOL + 1 (aktiv und die des Vorrats), alle bleiben im DOM und werden nie ersetzt. */
  private el: DeckEl | null = null;
  private pool: Record<Lane, DeckEl[]> = { plain: [], level: [] };
  private laneOf = new Map<DeckEl, Lane>();
  private lane: Lane = 'plain';
  /** Der Vorrat in Reihenfolge der Warteschlange (Brief 14): je Eintrag ein Element mit dem Anfang eines der nächsten Momente */
  private entries: PoolEntry[] = [];
  /** Runde 12: letzter Aufruf von fill (für das Nachfüllen nach einer Zurückstellung), zusätzliche Netz-Abrufe durch den Zeitgeber, Zeile schon geschrieben, Zeitgeber */
  private lastFill: { clips: readonly DeckClip[]; locOf: (key: string) => LocalClip | undefined; activePending: boolean } | null = null;
  private extraNet = 0;
  private deferNoted = false;
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
  /** Das Element spielt gerade (Ereignis playing kam, seitdem weder Pause noch Puffern noch neue Quelle) */
  private live = false;
  /** Seit dem Laden dieses Ausschnitts kam mindestens ein playing */
  private played = false;
  private plays = 0;
  /** Zeitpunkt des Startversuchs, dessen play() noch aussteht (0: keiner), und seine Marke, damit ein altes Ergebnis einen neuen Ausschnitt nicht freigibt */
  private inflightAt = 0;
  private kickTok = 0;
  private skipNoted = false;
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

  constructor(private deps: DeckDeps) {}

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
    return this.pool[lane].find((e) => e !== this.el && !this.entryOf(e)) ?? this.makeEl(lane);
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

  private wire(el: DeckEl) {
    // Ereignisse des gerade nicht benutzten Elements zählen nicht, die eines Vorrats-Elements gehen nur an seine Bereitschaft (eine Verdrahtung je Element, nie doppelt)
    const mine = () => el === this.el;
    const entry = () => this.entryOf(el);
    el.addEventListener('playing', () => {
      if (!mine()) return;
      if (this.adv && this.adv.to === this.clip?.id) {
        this.note(`advance to ${this.adv.to}: playing after ${Date.now() - this.adv.t0} ms, rate ${el.playbackRate}, ${this.stateText(el)}`);
        this.adv = null;
      }
      this.live = true;
      this.played = true;
      // Runde 12: der aktive Moment spielt, zurückgestellte Vorlade-Abrufe starten jetzt (bis POOL)
      if (this.deferNoted) this.refillDeferred();
      this.onMedia?.('playing');
      this.loading(false);
      this.snd = reduceSound(this.snd, 'playing', el);
      this.sink?.state(PLAYING);
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
    });
    el.addEventListener('waiting', () => {
      if (!mine()) return;
      this.live = false;
      this.sink?.state(BUFFERING);
      this.tick(el);
    });
    el.addEventListener('pause', () => {
      const by = this.pauseBy.get(el);
      this.pauseBy.delete(el);
      if (mine()) this.note(`pause event by=${by ?? (el.ended ? 'media end' : 'system')} hidden=${this.hidden()} done=${this.done} ${this.stateText(el)}`);
      if (!mine()) return;
      this.snd = reduceSound(this.snd, 'pause', el);
      this.sink?.sound?.();
      this.tick(el);
      // Ein Pause-Ereignis, das einem Quellwechsel vorausging, ist veraltet: das Element spielt schon wieder
      if (!el.paused || this.done) return;
      // Am Ende der Quelle kommt pause vor ended. Das ist kein Anhalten: sonst meldet die App Pause, die Media Session steht auf paused,
      // und der Sperrbildschirm zeigt Pause, während der Ende-Handler gleich den nächsten Moment startet.
      if (el.ended) return;
      this.live = false;
      this.sink?.state(PAUSED);
    });
    el.addEventListener('volumechange', () => {
      if (!mine()) return;
      this.snd = reduceSound(this.snd, 'volumechange', el);
      this.sink?.sound?.();
    });
    // Ein ended ohne vorheriges playing dieses Ausschnitts stammt vom vorigen Inhalt (zum Beispiel der Stille der Freischaltung) und zählt nicht
    el.addEventListener('ended', () => {
      if (mine() && this.hidden()) this.hiddenStats.ended++;
      if (mine()) this.note(`ended event played=${this.played} hidden=${this.hidden()} ${this.stateText(el)}`);
      if (mine() && this.played) this.clipEnd('ended');
    });
    el.addEventListener('timeupdate', () => {
      if (mine()) this.tick(el);
      const c = this.clip;
      if (mine() && this.hidden()) this.hiddenStats.tu++;
      if (!mine() || !c || c.end === undefined || el.paused) return;
      if (el.currentTime >= c.end - this.offset - END_EPS) this.clipEnd('timeupdate');
    });
    el.addEventListener('loadedmetadata', () => {
      const e = entry();
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
      this.onMedia?.('loadedmetadata');
    });
    // Zweiter Anstoß, wenn Daten da sind und das erste play() nichts bewirkt hat (iOS verwirft play() vor den Metadaten manchmal still)
    el.addEventListener('canplaythrough', () => {
      const e = entry();
      if (!e) return;
      e.cpt = true;
      this.checkEntry(e);
    });
    el.addEventListener('seeked', () => {
      const e = entry();
      if (e) this.checkEntry(e);
    });
    el.addEventListener('canplay', () => {
      const e = entry();
      if (e) this.checkEntry(e);
      if (mine()) this.loading(false);
      if (mine() && this.clip && this.want && el.paused && !this.done && !this.nudged && this.refusedKey !== this.clip.key) {
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
    // Runde 12: der Vorrat hält genau diesen Ausschnitt. Sein Element wird übernommen, auch wenn es noch lädt (es hat schon Bytes an der richtigen Stelle).
    // Verworfen wird nur ein Eintrag mit Fehler oder einer Spur, die nicht mehr passt, dann lädt der Start das Element neu.
    const inPool = this.entries.find((x) => x.clip.key === clip.key);
    if (inPool && this.adopt(inPool, play, forcePlain, from)) return;
    const loc = this.deps.local(clip.key);
    // Spurwahl (Lautheit): das Element der Spur, bei Misserfolg der Kette das unveränderte
    const pick = this.deps.lane?.(clip, !!loc, forcePlain) ?? { lane: 'plain' as const, why: 'no value' };
    let lane = pick.lane;
    let why = forcePlain && forceWhy ? forceWhy : pick.why;
    let target = this.ensure(lane);
    let chain: { linear: () => number } | null = null;
    if (lane === 'level') {
      chain = this.deps.chain?.(target, clip.gain ?? 0) ?? null;
      if (!chain) {
        lane = 'plain';
        why = 'no audio graph';
        target = this.ensure('plain');
      }
    }
    const old = this.el;
    this.el = target;
    this.lane = lane;
    this.loudLinear = chain ? chain.linear : null;
    this.loudInfo = chain ? { db: clip.gain ?? 0, how: 'web audio' } : { db: 0, how: `unchanged: ${why}` };
    if (old && old !== target) {
      // Spurwechsel: das alte Element anhalten und die Quelle freigeben (höchstens 3 Elemente mit Quelle), Ton übernehmen (das Tempo setzt applyRate gleich)
      target.muted = old.muted;
      this.halt(old, 'app: lane switch');
      this.clearSrc(old);
    }
    const el = target;
    this.clip = clip;
    this.done = false;
    this.nudged = false;
    this.live = false;
    this.played = false;
    this.want = play;
    this.inflightAt = 0;
    this.kickTok++;
    this.skipNoted = false;
    this.needTapKey = '';
    this.offset = loc?.offset ?? 0;
    this.isLocal = !!loc;
    this.resumeFrom = from;
    this.target = Math.max(0, from - this.offset);
    this.history.push(clip.key);
    if (this.history.length > 200) this.history.shift();
    this.snd = { muted: isSilent(el), playing: false, refused: false };
    // Untertitel (Issue 15): bei Quell- und Spurwechsel die Zeit übernehmen und halten, bis das Element selbst wieder misst
    this.sink?.time?.(from, el.playbackRate || 1, false);
    // Eine Zeile je Start: kam die Quelle aus dem Offline-Vorrat (Blob) oder aus dem Netz (Issue 14)
    this.diag(`deck: src ${loc ? 'local' : 'net'} ${clip.id}`);
    const srcUrl = loc?.url ?? withStart(clip.url, from);
    el.src = srcUrl;
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
    // Issue 58: ein Netzstart mit Startpunkt trägt ihn schon im Fragment (#t=). Ein Sprung vor den Metadaten ließe den Host zweimal an die späte Stelle suchen,
    // der Sprung nach loadedmetadata (seek(true)) greift nur, wenn das Element die Stelle nicht angenommen hat.
    if (!(this.target > 0 && !loc && srcUrl.includes('#t='))) this.seek(false);
    if (play) this.kick('start');
  }

  private hold(clip: DeckClip, play: boolean, forcePlain: boolean, from: number, forceWhy: string | undefined, wait: Promise<boolean>, what = 'storage') {
    const token = ++this.holdToken;
    this.holding = clip;
    this.clip = clip;
    this.done = false;
    this.want = play;
    this.live = false;
    this.played = false;
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
    this.sink?.time?.(el.currentTime + this.offset, el.playbackRate || 1, !el.paused && this.live);
    this.position(el);
  }

  private stateText(el: DeckEl) {
    return `rs=${el.readyState} muted=${el.muted} t=${el.currentTime.toFixed(1)}`;
  }

  private kick(why: string) {
    const el = this.element;
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
        this.unlockedEls.add(el);
        if (el === this.el) this.needTapKey = '';
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
   * Brief 22 (Entscheidung 57): der Vorrat füllt sich sofort beim Start, vor dem ersten play() und vor der ersten Geste. Die Geste holt unlock() nach:
   * sie spielt jedes Element des Vorrats, das sie noch nicht gesehen hat, stumm an und hält es gleich wieder an (gesturePool).
   */
  fill(clips: readonly DeckClip[], locOf: (key: string) => LocalClip | undefined = this.deps.local, activePending = false): number {
    if (!this.deps.standby || this.hidden()) return this.entries.length;
    this.lastFill = { clips, locOf, activePending };
    const cand: DeckClip[] = [];
    for (const c of clips) {
      if (this.clip?.key === c.key && !this.done) continue;
      if (!cand.some((w) => w.key === c.key)) cand.push(c);
    }
    const loc = new Map(cand.map((c) => [c.key, locOf(c.key)] as const));
    // Auswahl: der nächste Kandidat, dann alle lokalen in Reihenfolge, dann Netz bis POOL. Der Vorrat bleibt in Reihenfolge der Warteschlange.
    const chosen = new Set<string>(cand.slice(0, 1).map((c) => c.key));
    const rest = cand.slice(1);
    for (const c of [...rest.filter((x) => loc.get(x.key)), ...rest.filter((x) => !loc.get(x.key))]) {
      if (chosen.size >= POOL) break;
      chosen.add(c.key);
    }
    const want = cand.filter((c) => chosen.has(c.key));
    const keys = new Set(want.map((c) => c.key));
    let changed = false;
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
    // Runde 12: Vorrang für den aktiven Moment. Spielt er noch nicht, läuft höchstens ein Netz-Abruf (der für den nächsten Moment, er steht in der Reihenfolge vorn).
    // Lokale Quellen kosten kein Netz und laufen immer. Die übrigen starten, sobald der aktive spielt, oder nach FILL_DEFER_MS nacheinander.
    let deferred = 0;
    if (this.activeBusy(activePending)) {
      let room = Math.max(0, 1 + this.extraNet - this.entries.filter((e) => !e.local && !e.ready).length);
      order = order.filter((c) => {
        if (loc.get(c.key)) return true;
        if (room > 0) {
          room--;
          return true;
        }
        deferred++;
        return false;
      });
    } else this.extraNet = 0;
    if (deferred > 0) {
      if (!this.deferNoted) {
        this.deferNoted = true;
        this.diag('deck: pool fill deferred (active not playing)');
      }
      if (!this.deferTimer) {
        this.deferTimer = setTimeout(() => {
          this.deferTimer = null;
          this.extraNet++;
          this.refillDeferred();
        }, FILL_DEFER_MS);
      }
    } else {
      this.deferNoted = false;
      if (this.deferTimer) clearTimeout(this.deferTimer);
      this.deferTimer = null;
    }
    for (const c of order) {
      this.startEntry(c, loc.get(c.key));
      changed = true;
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
    const s: PoolEntry = { clip, el, lane, why, chain, local: !!loc, offset, target, meta: false, cpt: false, ready: false, rsAtReady: 0, t0: Date.now() };
    this.entries.push(s);
    this.diag(`deck: pool load ${clip.id} src=${loc ? 'local' : 'net'}`);
    el.src = loc?.url ?? withStart(clip.url, clip.start);
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
      if (this.entries.includes(s) && !s.ready) this.diag(`deck: pool slow ${clip.id} 8000 ms rs=${el.readyState} meta=${s.meta}`);
    }, 8000);
    this.checkEntry(s);
    return s;
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
    if (Math.abs(el.currentTime - s.target) > SEEK_TOL) return;
    const rs = el.readyState;
    if (!(s.cpt || rs >= 4 || (s.local && rs >= 3))) return;
    s.ready = true;
    s.rsAtReady = rs;
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
  }

  /** Die Quelle eines Eintrags lud nicht: aus dem Vorrat einmal vom Netz, in der geregelten Spur einmal unverändert. Sichtbar füllt der Host neu. */
  private entryError(e: PoolEntry) {
    this.diag(`deck: pool failed ${e.clip.id} (${e.local ? 'local' : e.lane})`);
    const { clip, local, lane } = e;
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
    const e = this.entries.find((x) => x.clip.key === key);
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
    this.entries = this.entries.filter((x) => x !== s);
    this.depleted = true;
    this.extraNet = 0;
    if (old) el.muted = old.muted;
    this.el = el;
    this.lane = s.lane;
    this.loudLinear = s.chain ? s.chain.linear : null;
    this.loudInfo = s.chain ? { db: clip.gain ?? 0, how: 'web audio' } : { db: 0, how: `unchanged: ${s.why}` };
    this.holding = null;
    this.holdToken++;
    this.clip = clip;
    this.done = false;
    this.nudged = false;
    this.live = false;
    this.played = false;
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
    this.history.push(clip.key);
    if (this.history.length > 200) this.history.shift();
    this.snd = { muted: isSilent(el), playing: false, refused: false };
    // Der alte Player gibt ab (wie beim automatischen Weiter), der neue übernimmt später über load(), das den laufenden Ausschnitt erkennt (holds)
    // Der Sink steht vor dem play(): ein Element meldet "playing" auch synchron, der neue Player soll den Zustand nie verpassen
    if (!via?.keepSink) this.sink = sink;
    this.applyRate(el);
    if (s.ready) this.diag(`deck: swap ${clip.id} ready=true pool=${this.readyCount()}`);
    else {
      // Runde 12: der Eintrag lädt noch. Sein Element behält Quelle und Bytes, nach den Metadaten springt seek(true) an die Position (loadedmetadata, mine).
      this.diag(`deck: pool adopt ${clip.id} rs=${el.readyState} meta=${s.meta} after ${Date.now() - s.t0} ms`);
      if (s.meta) this.seek(true);
      this.loading(!s.local && el.readyState < 3);
    }
    if (play) this.kick('swap');
    // Das alte Element geht frei in den Vorrat zurück: pausiert, Quelle bleibt bis zur nächsten Befüllung (kein load() verdeckt)
    if (old && old !== el) this.halt(old, 'app: swap');
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
      this.snd = reduceSound(this.snd, 'refused', this.el);
      this.sink?.sound?.();
    }
    if (c && this.refusedKey !== c.key) {
      this.refusedKey = c.key;
      this.diag(`bg: play rejected ${name}`);
    }
    this.diag(`deck play refused ${name} (${why}) ${c?.id ?? ''}`);
    // Abgelehnt heißt: dieses Element hat keine Freigabe. Ein Anstoß im Ereignis pointerdown (unlock) ist kein Anlass für die Tippfläche, der Tipp folgt gleich mit pointerup.
    if (name === 'NotAllowedError') {
      if (this.el) this.unlockedEls.delete(this.el);
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
    this.holdToken++;
    this.holding = null;
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
    this.depleted = false;
    if (this.deferTimer) clearTimeout(this.deferTimer);
    this.deferTimer = null;
    this.deferNoted = false;
    this.lastFill = null;
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
    el.muted = opts.muted;
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
      if (this.el) this.el.muted = opts.muted;
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
    if (this.sink === sink && this.el) this.el.muted = muted;
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
   */
  private probe(el: DeckEl) {
    if (el === this.el || this.unlockedEls.has(el)) return;
    // Ein Versuch ist unterwegs: kein zweiter (ein abgelehnter ist nach Millisekunden entschieden, der Tipp bringt pointerup, touchend und click kurz nacheinander)
    if (this.probes.has(el)) return;
    const r = { n: 1, muted: el.muted };
    this.probes.set(el, r);
    const gid = this.gid;
    const type = this.lastGesture;
    this.gestureOpen.set(gid, (this.gestureOpen.get(gid) ?? 0) + 1);
    const settle = (ok: boolean) => {
      if (ok) this.unlockedEls.add(el);
      r.n--;
      if (r.n <= 0 && this.probes.get(el) === r) {
        this.probes.delete(el);
        if (el !== this.el) {
          const e = this.entryOf(el);
          try {
            if (!el.paused) this.halt(el, 'app: gesture unlock');
            el.muted = r.muted;
            if (e) {
              // Die Position bleibt am Start des Ausschnitts (checkEntry zieht bei größerer Abweichung nach)
              if (e.ready && Math.abs(el.currentTime - e.target) > SEEK_TOL / 2) el.currentTime = e.target;
            } else this.clearSrc(el);
          } catch {
            /* Element schon weg */
          }
        }
      }
      const open = (this.gestureOpen.get(gid) ?? 1) - 1;
      this.gestureOpen.set(gid, open);
      // Kurz warten: das play() des aktiven Elements (unlock) endet im selben Atemzug und soll in der Zahl stehen
      if (open <= 0) setTimeout(() => this.unlockLine(gid, type), 50);
    };
    setTimeout(() => this.unlockLine(gid, type), UNLOCK_LINE_MS);
    try {
      el.muted = true;
      if (!this.entryOf(el) && !el.src) el.src = SILENT;
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
    for (const el of this.all()) this.silentPlay(el);
    this.gesturePool();
  }

  /**
   * Brief 22: der Vorrat füllt sich schon vor der ersten Geste. Ein Element, das dabei seine Quelle bekam, hat die Geste nie gesehen und dürfte verdeckt
   * nicht starten. Darum spielt die Geste jedes solche Element stumm an (probe): die Quelle bleibt, die Position bleibt, kein Ton. Jede Geste versucht es erneut,
   * bis ein play() angenommen wurde.
   */
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
    this.session();
    this.gid++;
    this.lastGesture = type;
    if (ACTIVATING.has(type)) this.actAt = Date.now();
    if (this.deps.standby) this.unlockSpares();
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

  /** readyState des aktiven Elements (der Feed gibt einen Moment mit Daten nie als hängend auf) */
  readyState(): number {
    return this.el?.readyState ?? 0;
  }
}
