// Diagnose-Protokoll der App (Max, 30.10.2026): eine Liste für Feed, Player, Hintergrund und Netz,
// in Settings per "Copy diagnostics" kopierbar. Nie Schlüssel oder Token.
// Entscheidung 31 (Core Wache): das Protokoll reist im Sync-Stand (Feld `diag`, Ringpuffer mit 500 Zeilen).
// Jede Zeile trägt dafür die Uhrzeit (ms) und eine kurze Geräte-Kennung. Zusammengeführt wird nach Zeit,
// die ältesten Zeilen fallen heraus. "Copy diagnostics" zeigt weiter nur die Zeilen dieser Sitzung.
import type { AppState } from './state';

/** Eine Zeile im Sync-Stand: t = Zeitpunkt (ms), d = Gerät, l = Text */
export interface DiagEntry {
  t: number;
  d: string;
  l: string;
}

/** Zeilen im Ringpuffer, in der Sitzung und im Sync-Stand */
export const DIAG_MAX = 500;
/** Längere Zeilen werden gekürzt, damit der Sync-Stand klein bleibt */
export const DIAG_LINE_MAX = 240;

const DEVICE_KEY = 'core.device.v1';
const t0 = Date.now();
const entries: DiagEntry[] = [];
let device: string | undefined;

const randomTag = () => Math.random().toString(36).slice(2, 6).padEnd(4, '0');

/** Kurze Kennung dieses Geräts (4 Zeichen), einmal erzeugt und in localStorage gehalten. Ohne Speicher gilt sie nur für diese Sitzung. */
export function deviceTag(): string {
  if (device) return device;
  let v: string | null = null;
  try {
    v = localStorage.getItem(DEVICE_KEY);
    if (!v || !/^[a-z0-9]{4}$/.test(v)) {
      v = randomTag();
      localStorage.setItem(DEVICE_KEY, v);
    }
  } catch {
    v = v && /^[a-z0-9]{4}$/.test(v) ? v : randomTag();
  }
  device = v;
  return v;
}

const stamp = (t: number) => {
  const s = Math.max(0, Math.round((t - t0) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export const diagLog = {
  push(line: string) {
    entries.push({ t: Date.now(), d: deviceTag(), l: line.slice(0, DIAG_LINE_MAX) });
    if (entries.length > DIAG_MAX) entries.splice(0, entries.length - DIAG_MAX);
  },
  /** Zeilen dieser Sitzung mit Zeitstempel mm:ss seit dem Start */
  lines(): readonly string[] {
    return entries.map((e) => `${stamp(e.t)} ${e.l}`);
  },
  /** Zeilen ohne Zeitstempel, für Tests und Zählungen */
  raw(): string[] {
    return entries.map((e) => e.l);
  },
  /** Zeilen dieser Sitzung mit Zeit und Gerät, für den Sync */
  entries(): readonly DiagEntry[] {
    return entries;
  },
  clear() {
    entries.length = 0;
  },
};

// ---------- Zusammenführen ----------

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const valid = (e: unknown): e is DiagEntry => !!e && typeof e === 'object' && Number.isFinite((e as DiagEntry).t) && typeof (e as DiagEntry).d === 'string' && typeof (e as DiagEntry).l === 'string';

/**
 * Vereinigung nach Zeit (dann Gerät, dann Text), gleiche Zeilen nur einmal, die letzten DIAG_MAX bleiben.
 * Vertauschbar, wiederholbar und gruppierbar, wie jede Zusammenführung im Sync. undefined, wenn auf beiden Seiten nichts steht.
 */
export function mergeDiag(a: readonly DiagEntry[] | undefined, b: readonly DiagEntry[] | undefined): DiagEntry[] | undefined {
  if (!a?.length && !b?.length) return undefined;
  const m = new Map<string, DiagEntry>();
  for (const e of [...(a ?? []), ...(b ?? [])]) if (valid(e)) m.set(`${e.t}\u0000${e.d}\u0000${e.l}`, { t: e.t, d: e.d, l: e.l.slice(0, DIAG_LINE_MAX) });
  const out = [...m.values()].sort((x, y) => x.t - y.t || cmp(x.d, y.d) || cmp(x.l, y.l)).slice(-DIAG_MAX);
  return out.length ? out : undefined;
}

export const diagEqual = (a: readonly DiagEntry[] | undefined, b: readonly DiagEntry[] | undefined): boolean => {
  const x = a ?? [];
  const y = b ?? [];
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i].t !== y[i].t || x[i].d !== y[i].d || x[i].l !== y[i].l) return false;
  return true;
};

/**
 * Zeilen dieser Sitzung in den Zustand falten (beim Verlassen der App), damit sie einen Neustart überleben und mit dem
 * nächsten Sync mitgehen. Ändert nichts, wenn alles schon drin steht (gleicher Verweis). Löst keinen Sync aus.
 */
export function foldDiag(s: AppState, lines: readonly DiagEntry[] = diagLog.entries()): AppState {
  if (!lines.length) return s;
  const merged = mergeDiag(s.diag, lines);
  return diagEqual(merged, s.diag) ? s : { ...s, diag: merged };
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => diagLog.push('net: online'));
  window.addEventListener('offline', () => diagLog.push('net: offline'));
  document.addEventListener('visibilitychange', () => diagLog.push(`app: ${document.visibilityState}`));
}

/** Netzart für die Video-Zeilen (Issue 22): navigator.connection.effectiveType, sonst "n/a" (Safari kennt es nicht) */
export const netType = (): string => {
  try {
    return (navigator as unknown as { connection?: { effectiveType?: string } }).connection?.effectiveType ?? 'n/a';
  } catch {
    return 'n/a';
  }
};
