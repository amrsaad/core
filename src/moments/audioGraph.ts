// Web Audio für die Lautheit (Entscheidung 16). Ein AudioContext, pro Media-Element eine Kette
// MediaElementSource, GainNode, Begrenzer, Ausgang. Der Kontext entsteht erst bei der ersten Berührung (iOS Safari).
// Vorher und bei jedem Fehler läuft das Element unverändert. Die Spurwahl steht in loudness.ts (laneFor).
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
        for (const f of stateListeners) f(ctx!.state);
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void ctx?.resume().catch(() => {});
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
