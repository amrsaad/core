// Offline-Vorrat: welche Momente vorgeladen werden, was bei 60 MB verdrängt wird und wann das Netz als schlecht gilt.
// Reine Funktionen ohne Browser, damit ios/Core/Preload.swift dieselben Regeln 1:1 nachziehen kann.
import type { Moment } from './types';
import { isYtId } from './contract';
import { localKey } from './localKey';

/** Wie viele Momente der Warteschlange ab dem nächsten vorgehalten werden */
export const PRELOAD_COUNT = 30;
/** Mehr als doppelt so viele werden auch bei 2x nicht vorgehalten (60 MB Obergrenze bleibt) */
export const PRELOAD_COUNT_MAX = PRELOAD_COUNT * 2;
/** Obergrenze für alle Ausschnitte zusammen */
export const PRELOAD_CAP_BYTES = 60 * 1024 * 1024;
/** Start über dieser Zeit gilt als langsam */
export const SLOW_MS = 1000;
/** So viele langsame Starts (oder Abrufe) in Folge machen das Netz schlecht */
export const SLOW_RUN = 3;

export type StreamKind = 'text' | 'mp3' | 'stream' | 'youtube' | 'none';

/**
 * Art der Quelle eines Moments.
 * mp3: eigener Stream, wird als Ausschnitt per Range vorgeladen. stream: m3u8, m4a, mp4 (v1 nicht vorgeladen, spielt wie bisher).
 * text braucht nichts, youtube wird nie vorgeladen.
 */
export function streamKind(m: Pick<Moment, 'form' | 'hls' | 'videoId'>): StreamKind {
  if (m.form === 'text') return 'text';
  if (m.hls) {
    let path = '';
    try {
      path = new URL(m.hls).pathname.toLowerCase();
    } catch {
      return 'stream';
    }
    return path.endsWith('.mp3') ? 'mp3' : 'stream';
  }
  return isYtId(m.videoId) ? 'youtube' : 'none';
}

export const isPreloadable = (m: Pick<Moment, 'form' | 'hls' | 'videoId'>) => streamKind(m) === 'mp3';

/** Schlüssel für einen Ausschnitt im Player (mehrere Momente einer Folge teilen die videoId) */
export { localKey };
export const keyOf = (m: Pick<Moment, 'videoId' | 'start' | 'end'>) => localKey(m.videoId, m.start, m.end);

export interface Ranked<T = Moment> {
  m: T;
  /** Abstand zum aktuellen Moment in der Warteschlange, 1 = der nächste */
  rank: number;
}

/** Die nächsten count Momente nach idx, in Reihenfolge der Warteschlange */
export function windowOf<T>(queue: T[], idx: number, count = PRELOAD_COUNT): Ranked<T>[] {
  const out: Ranked<T>[] = [];
  for (let r = 1; r <= count && idx + r < queue.length; r++) if (idx + r >= 0) out.push({ m: queue[idx + r], rank: r });
  return out;
}

/** Länge des Ausschnitts in Sekunden Inhalt, 0 wenn unbekannt */
const lenOf = (m: unknown): number => {
  const x = m as { start?: number; end?: number };
  return typeof x.start === 'number' && typeof x.end === 'number' && x.end > x.start ? x.end - x.start : 0;
};

/**
 * Fenster als Zeitfenster (Issue 13): bei Tempo r vergeht die Hörzeit r-mal so schnell, der Vorrat muss r-mal so viel Inhalt vorhalten.
 * Bei 1x genau die nächsten PRELOAD_COUNT. Sonst so viele, bis ihr Inhalt so lang ist wie der der nächsten PRELOAD_COUNT mal Tempo
 * (Längen aus start und end der Momente, fehlt eine Länge, zählt der Durchschnitt der bekannten), höchstens PRELOAD_COUNT_MAX.
 */
export function windowOfTime<T>(queue: T[], idx: number, rate = 1, count = PRELOAD_COUNT): Ranked<T>[] {
  const base = windowOf(queue, idx, count);
  if (!(rate > 1) || base.length === 0) return base;
  const lens = base.map((r) => lenOf(r.m));
  const known = lens.filter((l) => l > 0);
  const avg = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0;
  // Ohne jede bekannte Länge bleibt nur die Anzahl, skaliert mit dem Tempo
  if (avg === 0) return windowOf(queue, idx, Math.min(PRELOAD_COUNT_MAX, Math.ceil(count * rate)));
  const horizon = lens.reduce((a, l) => a + (l || avg), 0) * rate;
  const out: Ranked<T>[] = [];
  let sum = 0;
  for (let r = 1; sum < horizon && out.length < PRELOAD_COUNT_MAX && idx + r < queue.length; r++) {
    if (idx + r < 0) continue;
    const m = queue[idx + r];
    out.push({ m, rank: r });
    sum += lenOf(m) || avg;
  }
  return out;
}

/** Wie viele Momente der Feed im Voraus in der Warteschlange hält (Fenster plus Reserve) */
export const queueAhead = (rate = 1): number => Math.min(PRELOAD_COUNT_MAX, Math.ceil(PRELOAD_COUNT * (rate > 1 ? rate : 1))) + 2;

/** Nächster Moment, der geladen werden muss: nächstgelegener im Fenster, der vorladbar ist und noch fehlt */
export function nextToLoad<T extends Pick<Moment, 'id' | 'form' | 'hls' | 'videoId'>>(win: Ranked<T>[], have: ReadonlySet<string>, skip: (m: T) => boolean = () => false): Ranked<T> | null {
  for (const r of win) if (isPreloadable(r.m) && !have.has(r.m.id) && !skip(r.m)) return r;
  return null;
}

export interface Stored {
  id: string;
  bytes: number;
  /** Zeitpunkt des Ablegens (ms seit 1970), das Älteste geht zuerst */
  at: number;
}

export const totalBytes = (list: Stored[]) => list.reduce((s, e) => s + e.bytes, 0);

/**
 * Platz schaffen für need Bytes. Verdrängt wird das Älteste.
 * Zuerst Ausschnitte, die nicht mehr im Fenster liegen (schon gespielt oder aus der Warteschlange gefallen).
 * Danach nur solche, die weiter hinten liegen als der neue (rank größer), niemals ein näherer für einen ferneren.
 * ok false: es lässt sich nichts verdrängen, der neue Ausschnitt wird dann nicht geladen.
 */
export function planEviction(stored: Stored[], need: number, cap: number, newRank: number, rankOf: (id: string) => number | null, reserved = 0): { evict: string[]; ok: boolean } {
  // reserved: Bytes, die gleichzeitig ladende Abrufe schon beanspruchen
  let used = totalBytes(stored) + reserved;
  if (need > cap) return { evict: [], ok: false };
  if (used + need <= cap) return { evict: [], ok: true };
  const outside = stored.filter((e) => rankOf(e.id) === null || (rankOf(e.id) as number) < 1).sort((a, b) => a.at - b.at);
  const farther = stored.filter((e) => {
    const r = rankOf(e.id);
    return r !== null && r >= 1 && r > newRank;
  });
  // Unter den ferneren zuerst das Älteste
  farther.sort((a, b) => a.at - b.at);
  const evict: string[] = [];
  for (const e of [...outside, ...farther]) {
    if (used + need <= cap) break;
    evict.push(e.id);
    used -= e.bytes;
  }
  return { evict, ok: used + need <= cap };
}

/** "12.3" für Settings, eine Nachkommastelle, MB = 1024 * 1024 Bytes */
export const mbText = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);
/** Zeile unter Player in Settings */
export const preloadedLine = (n: number, bytes: number) => `Preloaded: ${n} ${n === 1 ? 'moment' : 'moments'}, ${mbText(bytes)} MB`;

// ---- Netz-bewusste Mischung ----

export interface NetSample {
  /** start: Wisch bis erstes Bild bei nicht vorgeladenem Moment. probe: Antwortzeit eines Vorlade-Abrufs. */
  k: 'start' | 'probe';
  ms: number;
}
const NET_MAX = 12;
export const addNet = (list: NetSample[], s: NetSample): NetSample[] => [...list, s].slice(-NET_MAX);

const lastSlow = (list: NetSample[], k: NetSample['k']) => {
  const l = list.filter((x) => x.k === k).slice(-SLOW_RUN);
  return l.length === SLOW_RUN && l.every((x) => x.ms > SLOW_MS);
};

/**
 * Schlechtes Netz: offline, oder die letzten drei Starts lagen über 1 s.
 * Starts aus dem Vorrat zählen nicht (sie sind immer schnell und würden den Zustand sofort zurückkippen),
 * dafür zählen die Antwortzeiten der Vorlade-Abrufe als zweites Maß, damit der Zustand ohne neuen langsamen Start wieder endet.
 */
export function isPoorNet(list: NetSample[], online: boolean): boolean {
  if (!online) return true;
  const starts = list.filter((x) => x.k === 'start');
  const probes = list.filter((x) => x.k === 'probe');
  // Ein frischer schneller Abruf nach den langsamen Starts beendet den Zustand
  const lastProbeFast = probes.length > 0 && probes[probes.length - 1].ms <= SLOW_MS;
  if (lastSlow(list, 'start') && !lastProbeFast) return true;
  return lastSlow(list, 'probe') && !(starts.length > 0 && starts[starts.length - 1].ms <= SLOW_MS);
}

/** Rang für die Mischung im schlechten Netz: 0 vorgeladen oder Text, 1 sonstiger Stream, 2 YouTube. Kleiner kommt eher. */
export function netRank(isCached: (id: string) => boolean): (m: Moment) => number {
  return (m) => {
    const k = streamKind(m);
    if (k === 'text' || isCached(m.id)) return 0;
    return k === 'youtube' ? 2 : 1;
  };
}
