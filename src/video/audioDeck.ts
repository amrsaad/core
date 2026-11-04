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

/** Null Sekunden Stille: schaltet das Element durch eine Geste frei, bevor der erste echte Moment kommt */
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

type Lane = 'plain' | 'level';

/** Der Ausschnitt, den das zweite Element (Standby) fertig geladen hält (Entscheidung 47, Brief 11) */
interface Standby {
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
  t0: number;
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
  /** Web Audio versagt in dieser Sitzung */
  broken?: (why: string) => void;
  /** Steht die Seite im Hintergrund (Standard: visibilityState hidden) */
  hidden?: () => boolean;
  /** Media Session des Betriebssystems setzen (Standard: navigator.mediaSession.playbackState), why für die Diagnose */
  playbackState?: (s: 'playing' | 'paused', why: string) => void;
  /** Zweites Element (Standby, Entscheidung 47): prepare() lädt den nächsten Ausschnitt dort vor, swap() tauscht nur die Rollen. Aus: prepare() tut nichts. */
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
export const withStart = (url: string, start: number): string => (start > 0 && !url.includes('#') ? `${url}#t=${start}` : url);

export class AudioDeck {
  /** Das aktive Element. Je Spur gibt es höchstens zwei (aktiv und frei für den Standby), alle bleiben im DOM und werden nie ersetzt. */
  private el: DeckEl | null = null;
  private pool: Record<Lane, DeckEl[]> = { plain: [], level: [] };
  private laneOf = new Map<DeckEl, Lane>();
  private lane: Lane = 'plain';
  /** Das zweite Element mit dem nächsten Ausschnitt (Entscheidung 47) */
  private standby: Standby | null = null;
  /** Elemente, die eine Geste schon einmal mit Stille gestartet hat (iOS erlaubt nur ihnen später play() im Hintergrund) */
  private unlockedEls = new WeakSet<DeckEl>();
  /** play() des aktiven Elements wurde erfüllt (nach jedem "deck play#N ok"): der Host bereitet danach den Standby vor */
  onPlayed: (() => void) | null = null;
  private loudInfo: { db: number; how: string } = { db: 0, how: 'unchanged: no value' };
  private loudLinear: (() => number) | null = null;
  /** Quelle, die in der geregelten Spur nicht lud. Lädt sie danach unverändert, gilt der Host als ohne CORS. */
  private trialFailed: string | null = null;
  private levelPrimed = false;
  /** Stelle (Tonzeit der Quelle), ab der der Ausschnitt zuletzt gestartet wurde: Rückfälle springen dorthin zurück, nie an den Anfang */
  private resumeFrom = 0;
  /** Der Ausschnitt, der gerade im Element steckt */
  clip: DeckClip | null = null;
  private armed: DeckClip | null = null;
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
  /** Beim automatischen Weiter im Hintergrund: der Wechsel ist schon geschehen, jetzt die Buchführung */
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

  /** Element der Spur: das aktive, wenn es zu ihr gehört, sonst ein freies (weder aktiv noch Standby), bei Bedarf neu angelegt */
  private ensure(lane: Lane): DeckEl {
    if (this.el && this.laneOf.get(this.el) === lane) return this.el;
    return this.spare(lane);
  }

  private spare(lane: Lane): DeckEl {
    return this.pool[lane].find((e) => e !== this.el && e !== this.standby?.el) ?? this.makeEl(lane);
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
    // Ereignisse des gerade nicht benutzten Elements zählen nicht, die des Standby gehen nur an seine Bereitschaft (eine Verdrahtung je Element, nie doppelt)
    const mine = () => el === this.el;
    const sb = () => this.standby?.el === el;
    el.addEventListener('playing', () => {
      if (!mine()) return;
      if (this.adv && this.adv.to === this.clip?.id) {
        this.note(`advance to ${this.adv.to}: playing after ${Date.now() - this.adv.t0} ms, rate ${el.playbackRate}, ${this.stateText(el)}`);
        this.adv = null;
      }
      this.live = true;
      this.played = true;
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
      if (sb() && this.standby) {
        this.standby.meta = true;
        this.checkStandby();
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
      if (!sb() || !this.standby) return;
      this.standby.cpt = true;
      this.checkStandby();
    });
    el.addEventListener('seeked', () => {
      if (sb()) this.checkStandby();
    });
    el.addEventListener('canplay', () => {
      if (sb()) this.checkStandby();
      if (mine()) this.loading(false);
      if (mine() && this.clip && this.want && el.paused && !this.done && !this.nudged && this.refusedKey !== this.clip.key) {
        this.nudged = true;
        this.kick('canplay');
      }
    });
    el.addEventListener('error', () => {
      if (sb()) {
        this.standbyError();
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
      const wait = !this.deps.local(clip.key) && (!this.clip || this.done) ? this.pending?.(clip.id, clip.key) : null;
      if (wait) {
        this.hold(clip, play, forcePlain, from, forceWhy, wait);
        return;
      }
    }
    this.holding = null;
    // Der Standby hält genau diesen Ausschnitt, aber er wird hier direkt gestartet: der Standby ist überholt, das Element wird frei
    if (this.standby?.clip.key === clip.key) this.dropStandby('started directly');
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
    el.src = loc?.url ?? withStart(clip.url, from);
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
    this.seek(false);
    if (play) this.kick('start');
  }

  private hold(clip: DeckClip, play: boolean, forcePlain: boolean, from: number, forceWhy: string | undefined, wait: Promise<boolean>) {
    const token = ++this.holdToken;
    this.holding = clip;
    this.clip = clip;
    this.done = false;
    this.want = play;
    this.live = false;
    this.played = false;
    this.diag(`deck: hold ${clip.id} for storage`);
    const t0 = Date.now();
    const timeout = new Promise<boolean>((r) => setTimeout(() => r(false), HOLD_MS));
    void Promise.race([wait, timeout]).then((ok) => {
      if (token !== this.holdToken || this.holding !== clip) return;
      this.diag(`deck: hold ${clip.id} ${ok ? 'released, storage ready' : 'timeout, from net'} after ${Date.now() - t0} ms`);
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
    const n = ++this.plays;
    if (this.hidden()) this.hiddenStats.plays++;
    this.diag(`deck play#${n} ${why} ${this.stateText(el)}`);
    let p: Promise<void> | undefined;
    try {
      p = el.play();
    } catch (e) {
      this.rejected(e, why);
      return;
    }
    p?.then?.(
      () => {
        this.unlocked = true;
        this.diag(`deck play#${n} ok`);
        // Nach jedem erfüllten play() bereitet der Host den nächsten Ausschnitt im Standby vor (Brief 11, Schritt 2)
        if (el === this.el) this.onPlayed?.();
      },
      // Ein Ergebnis des früheren Elements (Spurwechsel) zählt nicht
      (e: unknown) => el === this.el && this.rejected(e, why),
    );
  }

  // ---- Standby (Entscheidung 47, Brief 11): das zweite Element hält den nächsten Ausschnitt fertig, Weiter tauscht nur die Rollen ----

  /**
   * Nächsten Ausschnitt im zweiten Element vorladen: Quelle setzen (Vorrat lokal bevorzugt, sonst Netz), load(), Position auf den Start, warten auf
   * canplaythrough (lokal genügt readyState 3, sonst 4). Meldet "deck: standby ready". Verdeckt nur aus dem Vorrat (iOS lädt eine Netzquelle dann nicht).
   * true, wenn der Standby für diesen Ausschnitt läuft oder bereit ist.
   */
  prepare(clip: DeckClip, forcePlain = false): boolean {
    if (!this.deps.standby) return false;
    const cur = this.standby;
    if (cur?.clip.key === clip.key) return true;
    // Der Ausschnitt läuft schon im aktiven Element
    if (this.clip?.key === clip.key && !this.done) return false;
    const loc = this.deps.local(clip.key);
    if (!loc && this.hidden()) {
      this.diag(`deck: prepare ${clip.id} skipped (hidden, not in storage)`);
      return false;
    }
    if (cur) this.dropStandby('replaced');
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
    const s: Standby = { clip, el, lane, why, chain, local: !!loc, offset, target, meta: false, cpt: false, ready: false, t0: Date.now() };
    this.standby = s;
    this.diag(`deck: prepare ${clip.id} src=${loc ? 'local' : 'net'}`);
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
    setTimeout(() => {
      if (this.standby === s && !s.ready) this.diag(`deck: standby not ready ${clip.id} after 8000 ms rs=${el.readyState} meta=${s.meta}`);
    }, 8000);
    this.checkStandby();
    return true;
  }

  /** Metadaten da, Position gesetzt, genug Daten zum Durchspielen: der Standby ist bereit */
  private checkStandby() {
    const s = this.standby;
    if (!s || s.ready || !s.meta) return;
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
    this.diag(`deck: standby ready ${s.clip.id} after ${Date.now() - s.t0} ms`);
  }

  /** Die Quelle des Standby lud nicht: aus dem Vorrat einmal vom Netz (nur sichtbar), in der geregelten Spur einmal unverändert, sonst kein Standby */
  private standbyError() {
    const s = this.standby;
    if (!s) return;
    this.diag(`deck: standby failed ${s.clip.id} (${s.local ? 'local' : s.lane})`);
    const { clip, local, lane } = s;
    this.dropStandby('error');
    if (local) {
      this.deps.dropLocal(clip.key);
      this.prepare(clip);
    } else if (lane === 'level') {
      this.deps.host?.(clip.url, 'bad');
      this.prepare(clip, true);
    }
  }

  /** Standby verwerfen, das Element wird frei */
  dropStandby(why = 'dropped') {
    const s = this.standby;
    if (!s) return;
    this.standby = null;
    this.diag(`deck: standby dropped ${s.clip.id} (${why})`);
    this.clearSrc(s.el);
  }

  /** Ist der Standby bereit (für diesen Ausschnitt, wenn key gegeben)? */
  standbyReady(key?: string): boolean {
    return !!this.standby?.ready && (key === undefined || this.standby.clip.key === key);
  }

  get standbyKey(): string | null {
    return this.standby?.clip.key ?? null;
  }

  /**
   * Weiter ohne Quellwechsel: der Standby wird aktiv, play() läuft synchron auf ihm (im Call-Stack des Handlers), danach hält das alte Element an
   * und ist frei für den nächsten Standby. Nichts wird geladen. false, wenn kein bereiter Standby da ist, dann geschieht nichts.
   */
  swap(sink: DeckSink | null = null): boolean {
    const s = this.standby;
    if (!s || !s.ready) {
      this.diag(`deck: swap ${s?.clip.id ?? 'none'} ready=false`);
      return false;
    }
    // iOS hat den Web-Audio-Kontext unterbrochen: die geregelte Spur wäre stumm. Standby auf der unveränderten Spur neu, dieser Druck geht verloren.
    if (s.lane === 'level' && this.deps.running && !this.deps.running()) {
      this.diag(`deck: swap ${s.clip.id} ready=false (context not running)`);
      const c = s.clip;
      this.dropStandby('context not running');
      this.prepare(c, true);
      return false;
    }
    const old = this.el;
    const clip = s.clip;
    const el = s.el;
    this.standby = null;
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
    this.want = true;
    this.offset = s.offset;
    this.isLocal = s.local;
    this.resumeFrom = clip.start;
    this.target = s.target;
    this.history.push(clip.key);
    if (this.history.length > 200) this.history.shift();
    this.snd = { muted: isSilent(el), playing: false, refused: false };
    // Der alte Player gibt ab (wie beim automatischen Weiter), der neue übernimmt später über load(), das den laufenden Ausschnitt erkennt (holds)
    // Der Sink steht vor dem play(): ein Element meldet "playing" auch synchron, der neue Player soll den Zustand nie verpassen
    this.armed = null;
    this.sink = sink;
    this.applyRate(el);
    this.diag(`deck: swap ${clip.id} ready=true`);
    this.kick('swap');
    if (old && old !== el) this.halt(old, 'app: swap');
    this.deps.playbackState?.('playing', 'swap');
    return true;
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
  relevel(): boolean {
    const c = this.clip;
    const el = this.el;
    if (!c || !el || this.done || this.lane !== 'plain' || this.loudInfo.how !== 'unchanged: no audio context') return false;
    const pick = this.deps.lane?.(c, this.isLocal, false);
    if (!pick || pick.lane !== 'level') return false;
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

  /** Ende des Ausschnitts (timeupdate oder ended), höchstens einmal je Ausschnitt */
  private clipEnd(why: string) {
    const el = this.el;
    const c = this.clip;
    if (!el || !c || this.done) return;
    this.done = true;
    const next = this.armed;
    const hid = this.hidden();
    if (hid) this.hiddenStats.ends++;
    const go = !!(next && this.onAdvance && hid);
    this.note(`clip end via ${why} hidden=${hid} armed=${next?.id ?? 'none'} onAdvance=${!!this.onAdvance} advance=${go ? 'yes' : 'no'} ${this.stateText(el)}`);
    if (next && this.onAdvance && hid) {
      // Hintergrund: Quelle wechseln und play() im selben Handler. Erst danach die Buchführung der App.
      const from = c;
      this.armed = null;
      this.sink = null;
      this.diag(`deck switch ${from.id} to ${next.id} (${why})`);
      this.start(next, true);
      // Die Quelle des Nachfolgers wird erst hier gesetzt (nicht schon vor dem Ende), play() folgt im selben Aufruf auf demselben Element
      this.note(`advance ${from.id} to ${next.id}: src and play() in this handler, same element ${this.el === el}, next from storage ${this.isLocal}, readyState ${this.el?.readyState ?? '?'}`);
      this.adv = { to: next.id, t0: Date.now() };
      setTimeout(() => {
        if (this.adv?.to !== next.id) return;
        this.adv = null;
        if (this.el) this.note(`advance to ${next.id}: NOT playing after 3 s, ${this.stateText(this.el)} error ${this.el.error?.code ?? 'none'}`);
      }, 3000);
      // Die Media Session steht sofort auf playing, nicht erst nach dem ersten Ton der neuen Quelle
      this.deps.playbackState?.('playing', 'switch');
      try {
        this.onAdvance(from, next);
      } catch (e) {
        this.diag(`deck onAdvance failed ${e instanceof Error ? e.message : String(e)}`);
      }
      return;
    }
    // Vordergrund oder kein Nachfolger: anhalten und das Ende melden, die App entscheidet (Für-dich-Karte, Wisch)
    if (hid) this.diag(`bg: end without switch ${c.id} (armed ${next?.id ?? 'none'}, onAdvance ${this.onAdvance ? 'yes' : 'no'}), element stops`);
    this.halt(el, 'app: clip end in foreground');
    this.sink?.state(ENDED);
  }

  /** Nachfolger vorbereiten. null, wenn es keinen gibt. */
  arm(clip: DeckClip | null) {
    if ((clip?.key ?? null) !== (this.armed?.key ?? null)) this.diag(`bg: arm ${clip ? `${clip.id} (${this.deps.local(clip.key) ? 'local' : 'net'})` : 'none'}`);
    this.armed = clip;
  }

  get armedKey(): string | null {
    return this.armed?.key ?? null;
  }

  /** Aufräumen, wenn der Audio-Reiter verlassen wird: Ton aus, keine Rückrufe */
  release() {
    this.holdToken++;
    this.holding = null;
    this.loading(false);
    this.onStart = null;
    this.onLoading = null;
    this.pending = null;
    this.armed = null;
    this.onAdvance = null;
    this.onMedia = null;
    this.onPlayed = null;
    this.diag = () => {};
    this.standby = null;
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
    // Wisch auf den Moment, den der Standby fertig hält: Rollen tauschen statt die Quelle zu wechseln (Brief 11, Schritt 4)
    if (opts.play && this.standbyReady(clip.key) && this.swap(sink)) {
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
    // Mit Standby gibt es zwei Elemente der geregelten Spur: beide müssen die Geste gesehen haben, sonst startet das zweite verdeckt nicht
    this.ensureCount('level', this.deps.standby ? 2 : 1);
    for (const el of this.pool.level) this.silentPlay(el);
  }

  /** Element mit Stille starten, solange eine Geste läuft. Aktive und Standby-Elemente bleiben unberührt, ein schon freigeschaltetes ebenso. */
  private silentPlay(el: DeckEl) {
    if (el === this.el || el === this.standby?.el || this.unlockedEls.has(el)) return;
    this.unlockedEls.add(el);
    try {
      if (!el.src) el.src = SILENT;
      const p = el.play();
      const done = () => {
        if (el !== this.el && el !== this.standby?.el) this.clearSrc(el);
      };
      p?.then?.(done, done);
    } catch {
      /* kein Entsperren nötig oder möglich */
    }
  }

  /** Mit Standby gibt es ein zweites Element der unveränderten Spur: auch es per Geste freischalten (iOS erlaubt play() ohne Geste nur Elementen, die schon durch eine gespielt haben) */
  private unlockSpares() {
    this.ensureCount('plain', 2);
    for (const el of this.pool.plain) this.silentPlay(el);
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
  unlock() {
    this.session();
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
        },
        () => {},
      );
    } catch {
      /* ohne Geste nichts zu tun */
    }
  }
}
