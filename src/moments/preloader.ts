// Offline-Vorrat im Browser: lädt die nächsten 30 Momente der Warteschlange als Ausschnitt start bis end per Range-Request
// in die Cache API (Name core-preload-v1) und gibt sie dem Player als Blob-URL. Läuft im Hintergrund, ein Abruf nach dem anderen,
// bei WLAN und Mobilfunk gleich. Die Regeln (Auswahl, Verdrängung, Netzzustand) stehen in preload.ts.
import { LOCAL } from '../video/ytApi';
import { Mp3Error, readHead, sliceMp3, type Mp3Head, type RangeFetch } from './mp3range';
import { addNet, isPoorNet, keyOf, nextToLoad, planEviction, PRELOAD_CAP_BYTES, PRELOAD_COUNT, windowOf, type NetSample, type Ranked, type Stored } from './preload';
import type { Moment } from './types';

export const CACHE_NAME = 'core-preload-v1';
const INDEX_KEY = 'core.preload.v1';
/** Ausschnitte im Speicher als Blob-URL: ein paar zurück (Slots nutzen sie noch) und die nächsten */
const WARM_BACK = 3;
const WARM_AHEAD = 5;
/** Ab dieser Zahl Fehlschläge in Folge ohne einen Erfolg gilt ein Host als gesperrt (CORS oder Range nicht erlaubt) */
const HOST_STRIKES = 2;
const MAX_FAILS = 2;
/** So viele Abrufe laufen gleichzeitig im Hintergrund (bei hoher Latenz holt das die 30 Momente in vertretbarer Zeit) */
const CONCURRENCY = 3;

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
  private rank = new Map<string, number>();
  private warmed = new Map<string, { key: string; url: string }>();
  private heads = new Map<string, Mp3Head>();
  private fails = new Map<string, number>();
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

  constructor(private d: PreloaderDeps) {
    this.ready = this.init();
  }

  private note(s: string) {
    this.log.push(s);
    if (this.log.length > 200) this.log.shift();
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
    } catch (e) {
      this.cache = null;
      this.note(`init failed ${e instanceof Error ? e.message : String(e)}`);
    }
    this.emit();
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
    return isPoorNet(this.net, this.d.online());
  }
  netSamples() {
    return this.net;
  }

  // ---- Fenster und Laden ----

  /** Warteschlange hat sich bewegt oder geändert: die nächsten 30 nach idx */
  setQueue(queue: Moment[], idx: number) {
    this.win = windowOf(queue, idx, PRELOAD_COUNT);
    this.rank = new Map(this.win.map((r) => [r.m.id, r.rank]));
    this.deferred.clear();
    // Was gerade lädt und nicht mehr im Fenster liegt, abbrechen
    for (const [id, c] of this.active) if (!this.rank.has(id)) c.abort();
    this.fill();
  }

  /** Wieder online: Laden fortsetzen, Fehlversuche aus dem Netz vergessen */
  resume() {
    for (const [k, v] of this.fails) if (v < MAX_FAILS) this.fails.delete(k);
    this.fill();
  }

  private blocked(m: Moment) {
    const h = hostOf(m.hls ?? '');
    return (this.hostStrikes.get(h) ?? 0) >= HOST_STRIKES && !this.hostOk.has(h);
  }

  /** Moment kann nicht vorgeladen werden (Grund), null wenn es geht oder noch offen ist */
  whyNot(m: Moment): string | null {
    if (this.unsupported.has(m.id)) return this.unsupported.get(m.id)!;
    if (this.blocked(m)) return 'host';
    if ((this.fails.get(m.id) ?? 0) >= MAX_FAILS) return 'failed';
    return null;
  }

  /** Startet Abrufe, bis CONCURRENCY laufen: nächstgelegener fehlender Moment im Fenster zuerst */
  private fill() {
    if (!this.cache || !this.d.online()) return;
    while (this.active.size < CONCURRENCY) {
      const taken = new Set([...this.entries.keys(), ...this.active.keys()]);
      const job = nextToLoad(this.win, taken, (m) => this.whyNot(m) !== null || this.deferred.has(m.id));
      if (!job) break;
      this.active.set(job.m.id, new AbortController());
      void this.loadOne(job).finally(() => {
        this.active.delete(job.m.id);
        this.reserved.delete(job.m.id);
        // Ein Nahes, das mangels Platz zurückgestellt wurde, während ein Ferneres noch lud, darf das jetzt verdrängen.
        // Nur nach einem neuen Ausschnitt, sonst würde ein dauerhaft zurückgestelltes sich im Kreis bewerben.
        const r = this.rank.get(job.m.id);
        if (r !== undefined && this.entries.has(job.m.id)) for (const id of [...this.deferred]) if ((this.rank.get(id) ?? Infinity) < r) this.deferred.delete(id);
        this.fill();
      });
    }
  }

  private reservedBytes(except: string) {
    let n = 0;
    for (const [id, b] of this.reserved) if (id !== except) n += b;
    return n;
  }

  private fetchRange(url: string, signal: AbortSignal): RangeFetch {
    return async (from, to) => {
      const t0 = this.d.perfNow();
      const res = await this.d.fetchFn(url, { headers: { Range: `bytes=${from}-${to}` }, signal, credentials: 'omit', priority: 'low' } as RequestInit);
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
      if (!planEviction([...this.entries.values()], guess, PRELOAD_CAP_BYTES, job.rank, this.rankOf, this.reservedBytes(m.id)).ok) {
        this.deferred.add(m.id);
        this.note(`defer ${m.id} (full)`);
        return;
      }
      this.reserved.set(m.id, guess);
      const slice = await sliceMp3(fr, head, m.start, m.end);
      this.hostOk.add(host);
      this.hostStrikes.delete(host);
      const plan = planEviction([...this.entries.values()], slice.bytes.length, PRELOAD_CAP_BYTES, this.rank.get(m.id) ?? job.rank, this.rankOf, this.reservedBytes(m.id));
      if (!plan.ok) {
        this.deferred.add(m.id);
        this.note(`defer ${m.id} (full)`);
        return;
      }
      for (const id of plan.evict) await this.drop(id);
      if (!this.rank.has(m.id)) return; // aus dem Fenster gefallen, während es lud
      // Die echte Größe bleibt bis zum Eintrag reserviert, sonst nutzt ein anderer Abruf den Platz während des Schreibens
      this.reserved.set(m.id, slice.bytes.length);
      await this.cache!.put(this.keyFor(m.id), new Response(new Blob([slice.bytes as BlobPart], { type: 'audio/mpeg' }), { headers: { 'Content-Type': 'audio/mpeg', 'X-Offset': String(slice.offset), 'X-Src': url } }));
      this.entries.set(m.id, { id: m.id, bytes: slice.bytes.length, at: this.d.now(), offset: slice.offset, duration: slice.duration });
      this.reserved.delete(m.id);
      this.persist();
      this.note(`stored ${m.id} rank=${job.rank} ${slice.bytes.length}B offset=${slice.offset.toFixed(3)}`);
      this.emit();
      // Nahe Momente sofort als Blob-URL bereithalten
      if (job.rank <= WARM_AHEAD) await this.warm([m]);
    } catch (e) {
      // Kein halber Eintrag: was nicht vollständig im Index steht, fliegt auch aus dem Cache (Netz weg mitten im Schreiben)
      if (!this.entries.has(m.id)) void this.cache?.delete(this.keyFor(m.id)).catch(() => {});
      if (e instanceof DOMException && e.name === 'AbortError') return;
      if (e instanceof Mp3Error) {
        this.unsupported.set(m.id, e.reason);
        this.note(`unsupported ${m.id} ${e.reason}`);
      } else {
        // Ein Abruf, der scheitert, weil das Netz weg ist, ist kein Fehler des Moments und zählt nicht (Issue 9)
        if (this.d.online()) this.fails.set(m.id, (this.fails.get(m.id) ?? 0) + 1);
        // Netzfehler ohne Antwort bei bestehender Verbindung: meist CORS oder Range nicht erlaubt
        if (e instanceof TypeError && this.d.online()) this.hostStrikes.set(host, (this.hostStrikes.get(host) ?? 0) + 1);
        this.note(`fail ${m.id} ${e instanceof Error ? e.message : String(e)}`);
      }
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

  /** Blob-URLs für die Momente anlegen (nur wenn vorgeladen) und dem Player bekannt machen */
  async warm(ms: Moment[]) {
    await this.ready;
    if (!this.cache) return;
    for (const m of ms) {
      const e = this.entries.get(m.id);
      if (!e || this.warmed.has(m.id)) continue;
      try {
        const res = await this.cache.match(this.keyFor(m.id));
        if (!res) {
          this.entries.delete(m.id);
          this.persist();
          continue;
        }
        const blob = await res.blob();
        if (this.warmed.has(m.id) || !this.entries.has(m.id)) continue;
        const url = this.d.createObjectURL(blob);
        const key = keyOf(m);
        LOCAL.set(key, { url, offset: e.offset });
        this.warmed.set(m.id, { key, url });
      } catch (err) {
        this.note(`warm ${m.id} failed ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /** Blob-URLs weit hinter und vor dem Fenster freigeben. keep: IDs, die der Feed noch braucht */
  trimWarm(keep: ReadonlySet<string>) {
    for (const id of [...this.warmed.keys()]) if (!keep.has(id)) this.unwarm(id);
  }

  /** Momente um den aktuellen Index, deren Blob-URLs bereitstehen sollen */
  warmSet(queue: Moment[], idx: number): Moment[] {
    return queue.slice(Math.max(0, idx - WARM_BACK), idx + WARM_AHEAD + 1);
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
    storage,
    createObjectURL: (b) => URL.createObjectURL(b),
    revokeObjectURL: (u) => URL.revokeObjectURL(u),
    keyBase: new URL(import.meta.env.BASE_URL, location.origin).href,
  });
  window.addEventListener('online', () => shared?.resume());
  return shared;
}
