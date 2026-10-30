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

/** Null Sekunden Stille: schaltet das Element durch eine Geste frei, bevor der erste echte Moment kommt */
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

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
  playbackRate: number;
  defaultPlaybackRate: number;
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
}

const defaultMake = (level: boolean): DeckEl => {
  const a = document.createElement('audio');
  a.preload = 'auto';
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
  /** Das aktive Element. Es gibt höchstens zwei, je Spur eines (unverändert, geregelt), beide bleiben im DOM und werden nie ersetzt. */
  private el: DeckEl | null = null;
  private els: { plain: DeckEl | null; level: DeckEl | null } = { plain: null, level: null };
  private lane: 'plain' | 'level' = 'plain';
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
  /** Schlüssel aller Ausschnitte, die geladen wurden (Tests, Diagnose) */
  readonly history: string[] = [];
  /** Beim automatischen Weiter im Hintergrund: der Wechsel ist schon geschehen, jetzt die Buchführung */
  onAdvance: ((from: DeckClip, to: DeckClip) => void) | null = null;
  diag: (line: string) => void = () => {};

  constructor(private deps: DeckDeps) {}

  /** Das Element, angelegt beim ersten Gebrauch. Es wird nie ersetzt. */
  get element(): DeckEl {
    if (!this.el) this.el = this.ensure('plain');
    return this.el;
  }

  private ensure(lane: 'plain' | 'level'): DeckEl {
    let el = this.els[lane];
    if (!el) {
      el = (this.deps.make ?? defaultMake)(lane === 'level');
      this.els[lane] = el;
      this.wire(el);
    }
    return el;
  }

  private all(): DeckEl[] {
    return [this.els.plain, this.els.level].filter((x): x is DeckEl => !!x);
  }

  get exists(): boolean {
    return !!this.el;
  }

  private hidden = () => (this.deps.hidden ?? defaultHidden)();

  private wire(el: DeckEl) {
    // Ereignisse des gerade nicht benutzten Elements zählen nicht
    const mine = () => el === this.el;
    el.addEventListener('playing', () => {
      if (!mine()) return;
      this.live = true;
      this.played = true;
      this.sink?.state(PLAYING);
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
    });
    el.addEventListener('pause', () => {
      // Ein Pause-Ereignis, das einem Quellwechsel vorausging, ist veraltet: das Element spielt schon wieder
      if (!mine() || !el.paused || this.done) return;
      this.live = false;
      this.sink?.state(PAUSED);
    });
    // Ein ended ohne vorheriges playing dieses Ausschnitts stammt vom vorigen Inhalt (zum Beispiel der Stille der Freischaltung) und zählt nicht
    el.addEventListener('ended', () => {
      if (mine() && this.played) this.clipEnd('ended');
    });
    el.addEventListener('timeupdate', () => {
      const c = this.clip;
      if (!mine() || !c || c.end === undefined || el.paused) return;
      if (el.currentTime >= c.end - this.offset - END_EPS) this.clipEnd('timeupdate');
    });
    el.addEventListener('loadedmetadata', () => {
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
    });
    // Zweiter Anstoß, wenn Daten da sind und das erste play() nichts bewirkt hat (iOS verwirft play() vor den Metadaten manchmal still)
    el.addEventListener('canplay', () => {
      if (mine() && this.clip && this.want && el.paused && !this.done && !this.nudged && this.refusedKey !== this.clip.key) {
        this.nudged = true;
        this.kick('canplay');
      }
    });
    el.addEventListener('error', () => {
      const c = this.clip;
      if (!mine() || !c) return;
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
  private start(clip: DeckClip, play: boolean, forcePlain = false, from = clip.start, forceWhy?: string) {
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
      // Spurwechsel: das alte Element anhalten, Ton übernehmen (das Tempo setzt applyRate gleich)
      target.muted = old.muted;
      old.pause();
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
    el.src = loc?.url ?? withStart(clip.url, from);
    el.load();
    // load() setzt das Tempo auf den Standard zurück: Standard und aktuelles Tempo gemeinsam setzen
    this.applyRate(el);
    this.seek(false);
    if (play) this.kick('start');
  }

  private stateText(el: DeckEl) {
    return `rs=${el.readyState} muted=${el.muted} t=${el.currentTime.toFixed(1)}`;
  }

  private kick(why: string) {
    const el = this.element;
    const n = ++this.plays;
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
      },
      // Ein Ergebnis des früheren Elements (Spurwechsel) zählt nicht
      (e: unknown) => el === this.el && this.rejected(e, why),
    );
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
    if (next && this.onAdvance && this.hidden()) {
      // Hintergrund: Quelle wechseln und play() im selben Handler. Erst danach die Buchführung der App.
      const from = c;
      this.armed = null;
      this.sink = null;
      this.diag(`deck switch ${from.id} to ${next.id} (${why})`);
      this.start(next, true);
      try {
        this.onAdvance(from, next);
      } catch (e) {
        this.diag(`deck onAdvance failed ${e instanceof Error ? e.message : String(e)}`);
      }
      return;
    }
    // Vordergrund oder kein Nachfolger: anhalten und das Ende melden, die App entscheidet (Für-dich-Karte, Wisch)
    el.pause();
    this.sink?.state(ENDED);
  }

  /** Nachfolger vorbereiten. null, wenn es keinen gibt. */
  arm(clip: DeckClip | null) {
    this.armed = clip;
  }

  get armedKey(): string | null {
    return this.armed?.key ?? null;
  }

  /** Aufräumen, wenn der Audio-Reiter verlassen wird: Ton aus, keine Rückrufe */
  release() {
    this.armed = null;
    this.onAdvance = null;
    this.diag = () => {};
    this.sink = null;
    this.want = false;
    this.done = true;
    for (const e of this.all()) e.pause();
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
      } else el.pause();
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
    this.el.pause();
  }

  /** Dieser Player gibt das Element frei (destroy) */
  drop(sink: DeckSink) {
    if (this.sink !== sink) return;
    this.sink = null;
    this.want = false;
    this.el?.pause();
  }

  setMuted(sink: DeckSink, muted: boolean) {
    if (this.sink === sink && this.el) this.el.muted = muted;
  }

  /** Tempo gilt für das eine Element, egal welcher Player es setzt */
  setRate(rate: number) {
    this.rate = rate;
    for (const e of this.all()) this.applyRate(e);
  }

  /** Nur schreiben, was abweicht: unnötige Schreibzugriffe auf playbackRate lassen WebKit mit aktiver Media Session abstürzen (im Testrunner beobachtet) */
  private applyRate(el: DeckEl) {
    if (el.defaultPlaybackRate !== this.rate) el.defaultPlaybackRate = this.rate;
    if (el.playbackRate !== this.rate) el.playbackRate = this.rate;
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
    const el = this.ensure('level');
    if (el === this.el) return;
    try {
      if (!el.src) el.src = SILENT;
      const p = el.play();
      const done = () => {
        if (el !== this.el) el.pause();
      };
      p?.then?.(done, done);
    } catch {
      /* kein Entsperren nötig oder möglich */
    }
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

  /** Aus einer Geste heraus aufrufen: schaltet das Element für späteres play() ohne Geste frei. Wirkt nur einmal je Seite. */
  unlock() {
    if (this.unlocked) return;
    const el = this.ensure('plain');
    // Läuft oder wartet schon ein echter Ausschnitt, kommt die Freischaltung von dessen play(). Ein vom Menschen angehaltener bleibt angehalten.
    if (this.clip && !this.done) {
      if (this.want) this.kick('unlock');
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
