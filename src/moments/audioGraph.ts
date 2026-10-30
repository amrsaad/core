// Web Audio für die Lautheit (Entscheidung 16). Ein AudioContext, pro Media-Element eine Kette
// MediaElementSource, GainNode, Begrenzer, Ausgang. Der Kontext entsteht erst bei der ersten Berührung (iOS Safari).
// Vorher und bei jedem Fehler läuft das Element unverändert. Die Spurwahl steht in loudness.ts (laneFor).
import { diagLog } from '../lib/diag';
import { dbToLinear, LIMITER, type HostState } from './loudness';

const KEY_OFF = 'core.level.off';
const KEY_CORS = 'core.level.cors';

const store = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

let ctx: AudioContext | null = null;
/** Diese Sitzung hat Web Audio versagt: alles läuft unverändert, bis die Seite neu geladen wird */
let broken: string | null = null;
const unlockListeners = new Set<() => void>();
const stateListeners = new Set<(s: AudioContextState | 'interrupted') => void>();

/** Angleichen eingeschaltet (Settings, nur dieses Gerät). Standard an. */
export const levelOn = (): boolean => store()?.getItem(KEY_OFF) !== '1';
export function setLevelOn(on: boolean): void {
  try {
    if (on) store()?.removeItem(KEY_OFF);
    else store()?.setItem(KEY_OFF, '1');
  } catch { /* Speicher gesperrt: gilt nur für diese Sitzung nicht, kein Fehler */ }
}
export const levelEnabled = (): boolean => !broken && levelOn();
export const levelBroken = (): string | null => broken;
export function breakLevel(reason: string): void {
  broken ??= reason;
}

export const audioRunning = (): boolean => !!ctx && ctx.state === 'running';
/** Zustand des Kontexts für Diagnose: none (noch nicht angelegt), running, suspended oder interrupted (iOS) */
export const contextState = (): string => (ctx ? ctx.state : 'none');
/** Nur für Tests: der Kontext, um ihn anzuhalten */
export const contextForTest = (): AudioContext | null => ctx;
const bg = () => (typeof document !== 'undefined' ? document.visibilityState : 'visible');

/** Hosts, deren Quellen CORS erlauben (ok) oder nicht (bad). Gilt bis zum nächsten Fehlschlag, bleibt zwischen Sitzungen erhalten. */
const hostOf = (url: string): string => {
  try {
    return new URL(url, location.href).host;
  } catch {
    return '';
  }
};
const readHosts = (): Record<string, HostState> => {
  try {
    const x = JSON.parse(store()?.getItem(KEY_CORS) ?? '{}') as unknown;
    return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, HostState>) : {};
  } catch {
    return {};
  }
};
export const hostState = (url: string): HostState | undefined => readHosts()[hostOf(url)];
export function markHost(url: string, s: HostState): void {
  const h = hostOf(url);
  if (!h) return;
  const all = readHosts();
  if (all[h] === s) return;
  all[h] = s;
  try {
    store()?.setItem(KEY_CORS, JSON.stringify(all));
  } catch { /* Speicher gesperrt */ }
}

const probing = new Map<string, Promise<HostState | undefined>>();
const PROBE_MS = 8000;
const isStreamUrl = (u: string) => /^(blob|data):/i.test(u) || /\.m3u8(\?|#|$)/i.test(u);

/**
 * Erlaubt der Host der Quelle CORS? Ein winziger Abruf (Range 0 bis 0, Antwort wird nach den Kopfzeilen verworfen) klärt es, bevor ein Moment
 * die geregelte Spur versucht. So gibt es keinen Fehlversuch mitten im Ton (im Audio-Reiter teilen sich alle Momente ein Element).
 * Lesbar: Host ok. Fehler, aber derselbe Abruf ohne CORS erreicht den Host (opaque): Host ohne Freigabe, bad.
 * Beides scheitert (offline, Zeitüberschreitung): kein Urteil, der Versuch beim Abspielen entscheidet. Ergebnis wird in markHost gemerkt.
 */
export function probeHost(url: string, fetchFn: typeof fetch = (...a) => fetch(...a)): Promise<HostState | undefined> {
  const h = hostOf(url);
  if (!h || isStreamUrl(url)) return Promise.resolve(undefined);
  const known = readHosts()[h];
  if (known) return Promise.resolve(known);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve(undefined);
  const running = probing.get(h);
  if (running) return running;
  const once = async (mode: RequestMode): Promise<'readable' | 'opaque' | 'fail' | 'timeout'> => {
    const ac = new AbortController();
    let timedOut = false;
    const t = setTimeout(() => {
      timedOut = true;
      ac.abort();
    }, PROBE_MS);
    try {
      const res = await fetchFn(url, { method: 'GET', mode, credentials: 'omit', cache: 'no-store', signal: ac.signal, ...(mode === 'cors' ? { headers: { Range: 'bytes=0-0' } } : {}) });
      ac.abort(); // Rumpf nicht laden, falls der Server Range ignoriert und die ganze Datei schickt
      return res.type === 'opaque' ? 'opaque' : 'readable';
    } catch {
      return timedOut ? 'timeout' : 'fail';
    } finally {
      clearTimeout(t);
    }
  };
  const p = (async (): Promise<HostState | undefined> => {
    const a = await once('cors');
    if (a === 'readable') return markHost(url, 'ok'), 'ok';
    if (a !== 'fail') return undefined;
    if ((await once('no-cors')) === 'opaque') return markHost(url, 'bad'), 'bad';
    return undefined;
  })().finally(() => probing.delete(h));
  probing.set(h, p);
  return p;
}

/** Erste Berührung (dieselbe Stelle wie die Sound-Freischaltung): Kontext anlegen und starten. Mehrfach aufrufbar. Das Versprechen löst sich, sobald der Kontext läuft oder es nicht gelang. */
export function unlockAudio(): Promise<void> {
  if (typeof window === 'undefined' || !levelEnabled()) return Promise.resolve();
  let resumed: Promise<void> = Promise.resolve();
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) {
        breakLevel('no web audio');
        return Promise.resolve();
      }
      ctx = new AC({ latencyHint: 'playback' });
      // iOS 17 und neuer: Web Audio läuft bei gesperrtem Bildschirm weiter und ignoriert den Stumm-Schalter nicht mehr
      try {
        const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
        if (session) session.type = 'playback';
      } catch { /* nicht unterstützt */ }
      ctx.addEventListener('statechange', () => {
        // Zeile für die Hintergrund-Prüfung (Entscheidung 13): läuft der Kontext bei gesperrtem Bildschirm oder nicht
        diagLog.push(`loud: audiocontext ${ctx!.state} (app ${bg()})`);
        for (const f of stateListeners) f(ctx!.state);
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void ctx?.resume().catch(() => {});
        diagLog.push(`loud: audiocontext ${ctx?.state ?? 'none'} (app ${bg()})`);
        // Kurz danach noch einmal: iOS ändert den Zustand oft erst nach dem Sperren
        window.setTimeout(() => ctx && diagLog.push(`loud: audiocontext ${ctx.state} (app ${bg()}, after 1 s)`), 1000);
      });
    }
    resumed = ctx.resume().catch(() => {});
  } catch (e) {
    breakLevel(`context failed: ${e instanceof Error ? e.name : String(e)}`);
  }
  for (const f of unlockListeners) f();
  return resumed;
}

/** Wird bei jedem unlockAudio gerufen, solange registriert (Player bereiten dort ihre geregelten Elemente vor) */
export function onUnlock(f: () => void): () => void {
  unlockListeners.add(f);
  return () => unlockListeners.delete(f);
}
export function onContextState(f: (s: AudioContextState | 'interrupted') => void): () => void {
  stateListeners.add(f);
  return () => stateListeners.delete(f);
}

/** Kette hinter einem Media-Element. Ein Element bekommt höchstens eine, sie bleibt bis zum Ende der Seite. */
export class Chain {
  readonly gain: GainNode;
  readonly limiter: DynamicsCompressorNode;
  private dbNow = 0;
  constructor(c: AudioContext, el: HTMLMediaElement) {
    const src = c.createMediaElementSource(el);
    this.gain = c.createGain();
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = LIMITER.threshold;
    this.limiter.ratio.value = LIMITER.ratio;
    this.limiter.knee.value = LIMITER.knee;
    this.limiter.attack.value = LIMITER.attack;
    this.limiter.release.value = LIMITER.release;
    src.connect(this.gain);
    this.gain.connect(this.limiter);
    this.limiter.connect(c.destination);
  }
  setDb(db: number): void {
    this.dbNow = db;
    this.gain.gain.value = dbToLinear(db);
  }
  db(): number {
    return this.dbNow;
  }
  linear(): number {
    return this.gain.gain.value;
  }
}

const chains = new WeakMap<HTMLMediaElement, Chain>();

/** Kette für das Element, nur wenn der Kontext läuft. Sonst null: das Element bleibt unverändert. */
export function chainFor(el: HTMLMediaElement): Chain | null {
  const have = chains.get(el);
  if (have) return have;
  if (!ctx || !audioRunning() || !levelEnabled()) return null;
  try {
    const c = new Chain(ctx, el);
    chains.set(el, c);
    return c;
  } catch (e) {
    breakLevel(`chain failed: ${e instanceof Error ? e.name : String(e)}`);
    return null;
  }
}
