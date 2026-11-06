// Offline-Vorrat im Browser: lädt die nächsten 30 Momente der Warteschlange als Ausschnitt start bis end per Range-Request
// in die Cache API (Name core-preload-v1) und gibt sie dem Player als Blob-URL. Läuft im Hintergrund, ein Abruf nach dem anderen,
// bei WLAN und Mobilfunk gleich. Die Regeln (Auswahl, Verdrängung, Netzzustand) stehen in preload.ts.
import { LOCAL } from '../video/ytApi';
import { connPoor, readConn, type Conn } from './context';
import { Mp3Error, readHead, sliceMp3, type Mp3Head, type RangeFetch } from './mp3range';
import { addNet, isPoorNet, keyOf, nextToLoad, planEviction, PRELOAD_CAP_BYTES, windowOfTime, type NetSample, type Ranked, type Stored } from './preload';
import { headsKey, parseHeads, type Head } from './startHead';
import type { Moment } from './types';
import { dashName, lsKey } from '../lib/ns';

export const CACHE_NAME = dashName('core-preload-v1');
const INDEX_KEY = lsKey('preload.v1');
/** Ausschnitte im Speicher als Blob-URL: ein paar zurück (Slots nutzen sie noch) und die nächsten */
const WARM_BACK = 3;
const WARM_AHEAD = 5;
/** Ab dieser Zahl Fehlschläge in Folge ohne einen Erfolg gilt ein Host als gesperrt (CORS oder Range nicht erlaubt) */
const HOST_STRIKES = 2;
const MAX_FAILS = 2;
/** So viele Abrufe laufen gleichzeitig im Hintergrund (bei hoher Latenz holt das die 30 Momente in vertretbarer Zeit) */
const CONCURRENCY = 3;
/**
 * Brief 20 (Issue 47): ein Abruf ohne Ergebnis nach so langer Zeit gilt als hängend. Er wird abgebrochen und gibt seinen Platz frei. iOS hält Abrufe neben
 * laufenden Medien-Elementen zurück oder lässt sie nach dem Sperren nie antworten. Ohne diese Grenze belegen drei hängende Abrufe alle Plätze für immer,
 * und der Vorrat füllt sich nie, ohne dass ein Fehler im Protokoll steht.
 */
export const STALL_MS = 20000;
/** So lange bleibt ein Moment nach MAX_FAILS Fehlversuchen und ein Host nach HOST_STRIKES Netzfehlern ausgesetzt. Danach gibt es einen neuen Versuch (vorher: bis zum Ende der Sitzung). */
export const RETRY_MS = 30000;
/** So lange wartet ein Moment nach einem Abruf, der verdeckt scheiterte oder hing (nicht gezählt), bevor er neu gestartet wird. Ohne Wartezeit liefe ein sofort scheiternder Abruf in einer engen Schleife. */
export const HOLD_MS = 5000;
/** Vorrats-Tiefe: so viele der nächsten Momente zählen. Liegen weniger als DEPTH_URGENT davon im Vorrat, laufen die Abrufe mit hoher Priorität. */
export const DEPTH_WINDOW = 6;
export const DEPTH_URGENT = 3;

export interface CacheLike {
  put(key: string, res: Response): Promise<void>;
  match(key: string): Promise<Response | undefined>;
  delete(key: string): Promise<boolean>;
  keys(): Promise<readonly { url: string }[]>;
}

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export interface PreloaderDeps {
  openCache: () => Promise<CacheLike>;
  fetchFn: typeof fetch;
  now: () => number;
  perfNow: () => number;
  online: () => boolean;
  /** navigator.connection (Brief 09, Schritt 6): ein langsamer effectiveType oder downlink unter 1,5 Mbit/s gilt sofort als schlechtes Netz. Fehlt in iOS Safari. */
  conn?: () => Conn | undefined;
  /** App verdeckt (gesperrt oder im Hintergrund): ein Abruf, der dann scheitert, zählt weder gegen den Moment noch gegen den Host */
  hidden?: () => boolean;
  /** Grenzen für Tests (Standard STALL_MS und RETRY_MS) */
  stallMs?: number;
  retryMs?: number;
  holdMs?: number;
  storage: StorageLike | null;
  createObjectURL: (b: Blob) => string;
  revokeObjectURL: (u: string) => void;
  /** Basis der künstlichen Cache-Schlüssel, nur für die Cache API, wird nie abgerufen */
  keyBase: string;
}

interface Entry extends Stored {
  /** Tonzeit des ersten Bytes in der Quelle, Sekunden */
  offset: number;
  duration: number;
}

class HttpError extends Error {
  constructor(public status: number) {
    super(`http ${status}`);
  }
}

/** Antwort kürzer als angekündigt. Kein TypeError: sie zählt nicht gegen den Host (CORS, Range), nur als Fehlversuch dieses Moments. */
export class TruncatedError extends Error {
  constructor(got: number, announced: number) {
    super(`truncated ${got}/${announced}`);
  }
}

const hostOf = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return '';
  }
};

export class Preloader {
  private cache: CacheLike | null = null;
  private entries = new Map<string, Entry>();
  private win: Ranked<Moment>[] = [];
  /** Tempo des letzten setQueue, bestimmt wie weit voraus Blob-URLs bereitstehen */
  private rate = 1;
  private rank = new Map<string, number>();
  private warmed = new Map<string, { key: string; url: string }>();
  private heads = new Map<string, Mp3Head>();
  private fails = new Map<string, number>();
  /** Zeitpunkt des letzten gezählten Fehlversuchs je Moment und des letzten gezählten Netzfehlers je Host (Ende der Aussetzung nach RETRY_MS) */
  private failAt = new Map<string, number>();
  private strikeAt = new Map<string, number>();
  /** Bis wann ein Moment nach einem nicht gezählten Fehlschlag (verdeckt) wartet */
  private holdUntil = new Map<string, number>();
  /** Zeilen "stock: ..." für das Protokoll des Feeds, bis dieser sich anmeldet (setDiag) */
  private diagOut: ((line: string) => void) | null = null;
  private diagBuf: string[] = [];
  /** Stand "6 of 6" schon gemeldet (wieder frei, sobald die Tiefe fällt) */
  private full = false;
  /** Nicht vorladbar in dieser Sitzung (VBR, falsche Struktur, zu groß) */
  private unsupported = new Map<string, string>();
  /** Zu wenig Platz ohne Näheres zu verdrängen: wird erneut versucht, wenn sich das Fenster ändert */
  private deferred = new Set<string>();
  private hostStrikes = new Map<string, number>();
  private hostOk = new Set<string>();
  private net: NetSample[] = [];
  private listeners = new Set<() => void>();
  /** Laufende Abrufe: Moment-ID → Abbruch, dazu die geschätzte Größe */
  private active = new Map<string, AbortController>();
  private reserved = new Map<string, number>();
  private headP = new Map<string, Promise<Mp3Head>>();
  private ready: Promise<void>;
  readonly log: string[] = [];
  /** Die nächsten Audio-Momente der letzten Sitzung (startHead.ts): nie verdrängt, beim Start als Blob-URL bereit */
  private headList: Head[] = [];
  private pinned = new Set<string>();
  /** IDs im Index der letzten Sitzung, sofort lesbar (der Cache selbst öffnet asynchron) */
  private indexIds = new Set<string>();
  private inited = false;

  constructor(private d: PreloaderDeps) {
    this.readSync();
    this.ready = this.init();
  }

  /** Index und Köpfe synchron aus localStorage: der Feed weiß beim ersten Rendern, was im Vorrat liegt */
  private readSync() {
    try {
      const raw = this.d.storage?.getItem(INDEX_KEY);
      if (raw) for (const e of JSON.parse(raw) as Entry[]) if (e && typeof e.id === 'string') this.indexIds.add(e.id);
      this.headList = parseHeads(this.d.storage?.getItem(headsKey('audio')));
      this.pinned = new Set(this.headList.map((h) => h.id));
    } catch {
      /* kaputter Index: init gleicht mit dem Cache ab */
    }
  }

  /** Köpfe der letzten Sitzung (Schlüssel und ID) */
  startHeads(): readonly Head[] {
    return this.headList;
  }

  /** Die nächsten Audio-Momente festhalten: sie bleiben über das Sitzungsende im Vorrat und werden beim Start sofort bereitgestellt */
  setHeads(list: Head[]) {
    if (list.length === this.headList.length && list.every((h, i) => h.id === this.headList[i].id)) return;
    this.headList = list;
    this.pinned = new Set(list.map((h) => h.id));
    try {
      this.d.storage?.setItem(headsKey('audio'), JSON.stringify(list));
    } catch {
      /* kein Speicher */
    }
  }

  /** IDs aller Momente im Vorrat (vor dem Ende von init der Index der letzten Sitzung). Für den Start aus dem Vorrat, wenn die Köpfe nicht reichen. */
  heldIds(): string[] {
    return this.inited ? [...this.entries.keys()] : [...new Set([...this.indexIds, ...this.entries.keys()])];
  }

  /** Liegt der Moment im Vorrat? Vor dem Ende von init gilt der Index der letzten Sitzung. */
  held(id: string): boolean {
    return this.inited ? this.entries.has(id) : this.indexIds.has(id) || this.entries.has(id);
  }

  /**
   * Beim Kaltstart: der Ausschnitt liegt im Vorrat, seine Blob-URL entsteht aber erst, wenn init fertig ist. Das Versprechen löst sich dann
   * (true = Blob-URL liegt jetzt bereit). null, wenn nichts zu warten ist (schon bereit, nicht im Vorrat oder init lange fertig).
   */
  pendingWarm(id: string, key: string): Promise<boolean> | null {
    if (LOCAL.has(key) || this.inited || !this.indexIds.has(id)) return null;
    return this.ready.then(() => LOCAL.has(key));
  }

  private note(s: string) {
    this.log.push(s);
    if (this.log.length > 200) this.log.shift();
  }

  /** Eine Zeile "stock: ..." ins Protokoll des Feeds (Brief 20: jedes Ergebnis des Vorrats-Ladens steht dort, auch jeder Fehler) */
  private say(s: string) {
    const line = `stock: ${s}`;
    if (this.diagOut) this.diagOut(line);
    else {
      this.diagBuf.push(line);
      if (this.diagBuf.length > 30) this.diagBuf.shift();
    }
  }

  /** Der Feed meldet sich fürs Protokoll an (was vorher anfiel, kommt sofort nach) oder ab */
  setDiag(fn: ((line: string) => void) | null) {
    this.diagOut = fn;
    if (fn) for (const l of this.diagBuf.splice(0)) fn(l);
  }

  /** Wie viele der nächsten DEPTH_WINDOW Momente liegen im Vorrat? */
  depth(): number {
    let n = 0;
    for (const id of this.entries.keys()) {
      const r = this.rank.get(id);
      if (r !== undefined && r <= DEPTH_WINDOW) n++;
    }
    return n;
  }

  /** Läuft gerade ein Abruf für den Vorrat? (Das Deck wartet damit höchstens kurz auf Netz-Elemente, Brief 20) */
  busy(): boolean {
    return this.active.size > 0;
  }

  /** "6 of 6" einmal melden, wenn die Tiefe das Fenster füllt */
  private noteDepth() {
    const d = this.depth();
    if (d >= DEPTH_WINDOW && !this.full) {
      this.full = true;
      this.say(`${DEPTH_WINDOW} of ${DEPTH_WINDOW}`);
    } else if (d < DEPTH_WINDOW) this.full = false;
  }

  private async init() {
    try {
      this.cache = await this.d.openCache();
      const raw = this.d.storage?.getItem(INDEX_KEY);
      const idx: Entry[] = raw ? (JSON.parse(raw) as Entry[]) : [];
      const keys = new Set((await this.cache.keys()).map((k) => k.url));
      for (const e of idx) if (keys.has(this.keyFor(e.id))) this.entries.set(e.id, e);
      // Verwaiste Ausschnitte ohne Eintrag im Index räumen
      for (const k of keys) {
        const id = decodeURIComponent(k.slice(k.lastIndexOf('/') + 1));
        if (!this.entries.has(id)) await this.cache.delete(k);
      }
      // Die Köpfe sofort als Blob-URL bereitstellen, bevor der erste Moment startet
      for (const h of this.headList) await this.warmKey(h.id, h.key);
    } catch (e) {
      this.cache = null;
      this.note(`init failed ${e instanceof Error ? e.message : String(e)}`);
      this.say(`fail init ${e instanceof Error ? e.message : String(e)}`);
    }
    this.inited = true;
    this.emit();
    this.noteDepth();
    this.fill();
  }

  /** Wartet, bis der Index gelesen ist */
  whenReady() {
    return this.ready;
  }

  private keyFor(id: string) {
    return `${this.d.keyBase}__preload/${encodeURIComponent(id)}`;
  }

  private persist() {
    try {
      this.d.storage?.setItem(INDEX_KEY, JSON.stringify([...this.entries.values()]));
    } catch {
      /* kein Speicher: der Index wird beim nächsten Start aus dem Cache abgeglichen */
    }
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  private emit() {
    for (const f of this.listeners) f();
  }

  has = (id: string) => this.entries.has(id);
  stats() {
    let bytes = 0;
    for (const e of this.entries.values()) bytes += e.bytes;
    return { n: this.entries.size, bytes };
  }
  /** Anzahl der Momente mit bereitstehender Blob-URL (lokal abspielbar) */
  warmCount() {
    return this.warmed.size;
  }
  /** IDs der vorgeladenen Momente, für Tests und Diagnose */
  ids() {
    return [...this.entries.keys()];
  }

  // ---- Netzzustand ----

  recordStart(ms: number, buffered: boolean) {
    // Starts aus dem Vorrat sind immer schnell und sagen nichts über das Netz
    if (buffered) return;
    this.net = addNet(this.net, { k: 'start', ms });
    this.emit();
  }
  poor() {
    return isPoorNet(this.net, this.d.online()) || connPoor(this.d.conn?.());
  }
  netSamples() {
    return this.net;
  }

  // ---- Fenster und Laden ----

  /** Warteschlange hat sich bewegt oder geändert: die nächsten 30 nach idx, bei Tempo über 1x entsprechend mehr (Zeitfenster) */
  setQueue(queue: Moment[], idx: number, rate = 1) {
    this.rate = rate;
    this.win = windowOfTime(queue, idx, rate);
    this.rank = new Map(this.win.map((r) => [r.m.id, r.rank]));
    this.deferred.clear();
    // Was gerade lädt und nicht mehr im Fenster liegt, abbrechen
    for (const [id, c] of this.active) if (!this.rank.has(id)) c.abort();
    this.noteDepth();
    this.fill();
  }

  /** Wieder online: Laden fortsetzen, Fehlversuche aus dem Netz vergessen */
  resume() {
    for (const [k, v] of this.fails) if (v < MAX_FAILS) this.fails.delete(k);
    this.fill();
  }

  /** Host gesperrt (CORS oder Range nicht erlaubt)? Die Sperre gilt RETRY_MS, danach braucht der Host wieder zwei Netzfehler. */
  private blocked(m: Moment) {
    const h = hostOf(m.hls ?? '');
    if ((this.hostStrikes.get(h) ?? 0) < HOST_STRIKES || this.hostOk.has(h)) return false;
    if (this.d.now() - (this.strikeAt.get(h) ?? 0) < (this.d.retryMs ?? RETRY_MS)) return true;
    this.hostStrikes.delete(h);
    this.strikeAt.delete(h);
    return false;
  }

  /** Moment kann nicht vorgeladen werden (Grund), null wenn es geht oder noch offen ist */
  whyNot(m: Moment): string | null {
    if (this.unsupported.has(m.id)) return this.unsupported.get(m.id)!;
    if (this.blocked(m)) return 'host';
    if ((this.holdUntil.get(m.id) ?? 0) > this.d.now()) return 'paused';
    if ((this.fails.get(m.id) ?? 0) >= MAX_FAILS) {
      if (this.d.now() - (this.failAt.get(m.id) ?? 0) < (this.d.retryMs ?? RETRY_MS)) return 'failed';
      // Aussetzung vorbei: ein neuer Versuch, scheitert er, ist der Moment wieder RETRY_MS draußen
      this.fails.set(m.id, MAX_FAILS - 1);
    }
    return null;
  }

  /** Startet Abrufe, bis CONCURRENCY laufen: nächstgelegener fehlender Moment im Fenster zuerst */
  private fill() {
    if (!this.cache || !this.d.online()) return;
    while (this.active.size < CONCURRENCY) {
      const taken = new Set([...this.entries.keys(), ...this.active.keys()]);
      const job = nextToLoad(this.win, taken, (m) => this.whyNot(m) !== null || this.deferred.has(m.id));
      if (!job) break;
      this.start(job);
    }
  }

  /**
   * Einen Abruf starten, mit Wächter (Brief 20): kommt nach STALL_MS kein Ergebnis, wird er abgebrochen, zählt als Fehlversuch dieses Moments (nie gegen den Host)
   * und gibt seinen Platz frei, auch wenn der Abruf auf den Abbruch nicht reagiert. Danach kommt der nächste Moment dran.
   */
  private start(job: Ranked<Moment>) {
    const id = job.m.id;
    const ctl = new AbortController();
    this.active.set(id, ctl);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stall = new Promise<'stall'>((res) => {
      timer = setTimeout(() => {
        res('stall');
        ctl.abort();
      }, this.d.stallMs ?? STALL_MS);
    });
    void Promise.race([this.loadOne(job).then(() => 'done' as const), stall])
      .then((r) => {
        if (r === 'stall') this.onStall(job);
      })
      .finally(() => {
        clearTimeout(timer);
        // Hat der Wächter den Platz schon freigegeben und ein neuer Abruf desselben Moments läuft, bleibt der neue stehen
        if (this.active.get(id) === ctl) this.active.delete(id);
        this.reserved.delete(id);
        // Ein Nahes, das mangels Platz zurückgestellt wurde, während ein Ferneres noch lud, darf das jetzt verdrängen.
        // Nur nach einem neuen Ausschnitt, sonst würde ein dauerhaft zurückgestelltes sich im Kreis bewerben.
        const r = this.rank.get(id);
        if (r !== undefined && this.entries.has(id)) for (const other of [...this.deferred]) if ((this.rank.get(other) ?? Infinity) < r) this.deferred.delete(other);
        this.fill();
      });
  }

  /** Der Wächter hat einen hängenden Abruf abgebrochen */
  private onStall(job: Ranked<Moment>) {
    const m = job.m;
    const ms = this.d.stallMs ?? STALL_MS;
    // Verdeckt hält iOS Abrufe an: das ist kein Fehler dieses Moments
    if (this.d.hidden?.()) {
      this.holdUntil.set(m.id, this.d.now() + (this.d.holdMs ?? HOLD_MS));
      this.note(`stall ${m.id} ${ms} ms (hidden, not counted)`);
      this.say(`fail ${m.id} stall ${ms} ms (hidden, not counted)`);
      return;
    }
    if (!this.entries.has(m.id) && this.d.online()) {
      this.fails.set(m.id, (this.fails.get(m.id) ?? 0) + 1);
      this.failAt.set(m.id, this.d.now());
    }
    if (!this.entries.has(m.id)) void this.cache?.delete(this.keyFor(m.id)).catch(() => {});
    this.note(`fail ${m.id} stall ${ms} ms`);
    this.say(`fail ${m.id} stall ${ms} ms`);
  }

  private reservedBytes(except: string) {
    let n = 0;
    for (const [id, b] of this.reserved) if (id !== except) n += b;
    return n;
  }

  private fetchRange(url: string, signal: AbortSignal): RangeFetch {
    return async (from, to) => {
      const t0 = this.d.perfNow();
      // Dünner Vorrat (unter DEPTH_URGENT der nächsten DEPTH_WINDOW): hohe Priorität, damit die Abrufe nicht hinter den fünf Medien-Elementen des Decks warten (Brief 20).
      // Ist genug da, laufen sie leise im Hintergrund wie bisher.
      const priority = this.depth() < DEPTH_URGENT ? 'high' : 'low';
      const res = await this.d.fetchFn(url, { headers: { Range: `bytes=${from}-${to}` }, signal, credentials: 'omit', priority } as RequestInit);
      const ttfb = Math.round(this.d.perfNow() - t0);
      if (res.status !== 206) {
        void res.body?.cancel();
        throw new HttpError(res.status);
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      // Abgebrochene Übertragung (Netz weg mitten in der Antwort): kürzer als angekündigt gilt als nicht geladen, nie als Teilstück im Vorrat
      const announced = Number(res.headers.get('content-length'));
      if (Number.isFinite(announced) && announced > 0 && bytes.length !== announced) throw new TruncatedError(bytes.length, announced);
      // Antwortzeit als zweites Maß für das Netz (Starts aus dem Vorrat sagen darüber nichts)
      this.net = addNet(this.net, { k: 'probe', ms: ttfb });
      this.emit();
      return { bytes };
    };
  }

  private async loadOne(job: Ranked<Moment>) {
    const m = job.m;
    const url = m.hls!;
    const host = hostOf(url);
    const signal = this.active.get(m.id)!.signal;
    try {
      const fr = this.fetchRange(url, signal);
      let head = this.heads.get(url);
      if (!head) {
        let p = this.headP.get(url);
        if (!p) {
          p = readHead(fr);
          this.headP.set(url, p);
          p.then(
            (h) => this.heads.set(url, h),
            () => this.headP.delete(url),
          );
        }
        head = await p;
      }
      // Grobe Größe vorab: passt es nicht ohne Näheres zu verdrängen, gar nicht erst laden
      const guess = Math.ceil((m.end - m.start + 1.3) * ((head.bitrate * 1000) / 8));
      if (!planEviction([...this.entries.values()], guess, PRELOAD_CAP_BYTES, job.rank, this.rankOf, this.reservedBytes(m.id), this.pinned).ok) {
        this.deferred.add(m.id);
        this.note(`defer ${m.id} (full)`);
        this.say(`defer ${m.id} full`);
        return;
      }
      this.reserved.set(m.id, guess);
      const slice = await sliceMp3(fr, head, m.start, m.end);
      this.hostOk.add(host);
      this.hostStrikes.delete(host);
      const plan = planEviction([...this.entries.values()], slice.bytes.length, PRELOAD_CAP_BYTES, this.rank.get(m.id) ?? job.rank, this.rankOf, this.reservedBytes(m.id), this.pinned);
      if (!plan.ok) {
        this.deferred.add(m.id);
        this.note(`defer ${m.id} (full)`);
        this.say(`defer ${m.id} full`);
        return;
      }
      for (const id of plan.evict) await this.drop(id);
      if (!this.rank.has(m.id)) return; // aus dem Fenster gefallen, während es lud
      // Die echte Größe bleibt bis zum Eintrag reserviert, sonst nutzt ein anderer Abruf den Platz während des Schreibens
      this.reserved.set(m.id, slice.bytes.length);
      await this.cache!.put(this.keyFor(m.id), new Response(new Blob([slice.bytes as BlobPart], { type: 'audio/mpeg' }), { headers: { 'Content-Type': 'audio/mpeg', 'X-Offset': String(slice.offset), 'X-Src': url } }));
      this.entries.set(m.id, { id: m.id, bytes: slice.bytes.length, at: this.d.now(), offset: slice.offset, duration: slice.duration });
      this.reserved.delete(m.id);
      // Ein Erfolg löscht die Fehlversuche dieses Moments (sonst bliebe er nach zwei alten Fehlern bei jedem späteren Fehler sofort ausgesetzt)
      this.fails.delete(m.id);
      this.failAt.delete(m.id);
      this.holdUntil.delete(m.id);
      this.persist();
      this.note(`stored ${m.id} rank=${job.rank} ${slice.bytes.length}B offset=${slice.offset.toFixed(3)}`);
      this.say(`+1 ${m.id} (${this.depth()} of ${DEPTH_WINDOW})`);
      this.noteDepth();
      this.emit();
      // Nahe Momente sofort als Blob-URL bereithalten
      if (job.rank <= WARM_AHEAD * (this.rate > 1 ? this.rate : 1)) await this.warm([m]);
    } catch (e) {
      // Kein halber Eintrag: was nicht vollständig im Index steht, fliegt auch aus dem Cache (Netz weg mitten im Schreiben)
      if (!this.entries.has(m.id)) void this.cache?.delete(this.keyFor(m.id)).catch(() => {});
      // Abbruch: aus dem Fenster gefallen, oder vom Wächter (der zählt den Fehlversuch selbst, siehe onStall)
      if (e instanceof DOMException && e.name === 'AbortError') return;
      if (e instanceof Mp3Error) {
        this.unsupported.set(m.id, e.reason);
        this.note(`unsupported ${m.id} ${e.reason}`);
        this.say(`fail ${m.id} unsupported ${e.reason}`);
        return;
      }
      const why = e instanceof Error ? e.message : String(e);
      // Verdeckt halten iOS und der Browser das Netz an: ein Abruf, der dann scheitert, ist kein Fehler des Moments und kein Strike für den Host (Brief 20)
      if (this.d.hidden?.()) {
        this.holdUntil.set(m.id, this.d.now() + (this.d.holdMs ?? HOLD_MS));
        this.note(`fail ${m.id} ${why} (hidden, not counted)`);
        this.say(`fail ${m.id} ${why} (hidden, not counted)`);
        return;
      }
      const at = this.d.now();
      // Ein Abruf, der scheitert, weil das Netz weg ist, ist kein Fehler des Moments und zählt nicht (Issue 9)
      if (this.d.online()) {
        this.fails.set(m.id, (this.fails.get(m.id) ?? 0) + 1);
        this.failAt.set(m.id, at);
      }
      // Netzfehler ohne Antwort bei bestehender Verbindung: meist CORS oder Range nicht erlaubt
      if (e instanceof TypeError && this.d.online()) {
        const n = (this.hostStrikes.get(host) ?? 0) + 1;
        this.hostStrikes.set(host, n);
        this.strikeAt.set(host, at);
        if (n === HOST_STRIKES) this.say(`host ${host} paused ${(this.d.retryMs ?? RETRY_MS) / 1000} s after ${n} network errors`);
      }
      this.note(`fail ${m.id} ${why}`);
      this.say(`fail ${m.id} ${why}`);
    }
  }

  /** Rang im Fenster (1 = nächster). null = nicht im Fenster (gespielt oder verworfen) */
  private rankOf = (id: string): number | null => this.rank.get(id) ?? null;

  private async drop(id: string) {
    this.unwarm(id);
    this.entries.delete(id);
    try {
      await this.cache?.delete(this.keyFor(id));
    } catch {
      /* egal */
    }
    this.persist();
    this.note(`evict ${id}`);
    this.emit();
  }

  // ---- Wiedergabe: Blob-URL für den Player ----

  private unwarm(id: string) {
    const w = this.warmed.get(id);
    if (!w) return;
    LOCAL.delete(w.key);
    this.d.revokeObjectURL(w.url);
    this.warmed.delete(id);
  }

  /** Blob-URL für einen Eintrag anlegen (nur wenn vorgeladen) und dem Player bekannt machen */
  private async warmKey(id: string, key: string) {
    const e = this.entries.get(id);
    if (!e || this.warmed.has(id) || !this.cache) return;
    try {
      const res = await this.cache.match(this.keyFor(id));
      if (!res) {
        this.entries.delete(id);
        this.persist();
        return;
      }
      const blob = await res.blob();
      if (this.warmed.has(id) || !this.entries.has(id)) return;
      const url = this.d.createObjectURL(blob);
      LOCAL.set(key, { url, offset: e.offset });
      this.warmed.set(id, { key, url });
      // Brief 14b: ein Moment, der erst jetzt lokal bereitsteht, soll den Element-Vorrat des Decks neu ordnen können
      this.emit();
    } catch (err) {
      this.note(`warm ${id} failed ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Blob-URLs für die Momente anlegen (nur wenn vorgeladen) und dem Player bekannt machen */
  async warm(ms: Moment[]) {
    await this.ready;
    if (!this.cache) return;
    for (const m of ms) await this.warmKey(m.id, keyOf(m));
  }

  /** Blob-URLs weit hinter und vor dem Fenster freigeben. keep: IDs, die der Feed noch braucht */
  trimWarm(keep: ReadonlySet<string>) {
    for (const id of [...this.warmed.keys()]) if (!keep.has(id)) this.unwarm(id);
  }

  /** Momente um den aktuellen Index, deren Blob-URLs bereitstehen sollen */
  warmSet(queue: Moment[], idx: number, rate = 1): Moment[] {
    const ahead = Math.ceil(WARM_AHEAD * (rate > 1 ? rate : 1));
    return queue.slice(Math.max(0, idx - WARM_BACK), idx + ahead + 1);
  }

  /** Alles löschen (Tests, Zurücksetzen) */
  async clear() {
    await this.ready;
    for (const id of [...this.entries.keys()]) await this.drop(id);
  }
}

// ---- Browser-Einbindung ----

let shared: Preloader | null = null;

export function browserPreloader(): Preloader | null {
  if (shared) return shared;
  if (typeof caches === 'undefined' || typeof fetch === 'undefined') return null;
  let storage: StorageLike | null = null;
  try {
    storage = localStorage;
  } catch {
    storage = null;
  }
  shared = new Preloader({
    openCache: async () => {
      const c = await caches.open(CACHE_NAME);
      return {
        put: (k, r) => c.put(k, r),
        match: (k) => c.match(k),
        delete: (k) => c.delete(k),
        keys: async () => await c.keys(),
      };
    },
    fetchFn: (...a) => fetch(...a),
    now: () => Date.now(),
    perfNow: () => performance.now(),
    online: () => navigator.onLine,
    conn: readConn,
    hidden: () => document.visibilityState === 'hidden',
    storage,
    createObjectURL: (b) => URL.createObjectURL(b),
    revokeObjectURL: (u) => URL.revokeObjectURL(u),
    keyBase: new URL(import.meta.env.BASE_URL, location.origin).href,
  });
  window.addEventListener('online', () => shared?.resume());
  return shared;
}
