import { openDB, type IDBPDatabase } from 'idb';
import { emptyState, repair45, REPAIR45_KEY, type AppState } from './state';
import { diagLog } from './diag';

const DB = 'core';
const STORE = 'kv';
const KEY = 'state';

let dbp: Promise<IDBPDatabase> | null = null;
function db() {
  dbp ??= openDB(DB, 1, {
    upgrade(d) {
      d.createObjectStore(STORE);
    },
  });
  return dbp;
}

export async function loadState(): Promise<AppState> {
  try {
    const s = (await (await db()).get(STORE, KEY)) as AppState | undefined;
    if (!s) return emptyState();
    const settings = { ...emptyState().settings, ...s.settings };
    // Alter Standard 55/25/20 wurde am 23.10.2026 durch Gleichverteilung ersetzt (Themenplan mit Max)
    const a = settings.areaShares;
    if (a && a.brain === 0.55 && a.body === 0.25 && a.beat === 0.2) settings.areaShares = { ...emptyState().settings.areaShares };
    const loaded: AppState = { ...emptyState(), ...s, settings };
    const fixed = runRepair45(loaded);
    if (fixed !== loaded) await saveState(fixed);
    return fixed;
  } catch {
    return emptyState();
  }
}

/** Einmalige Reparatur (Entscheidung 45): Marker core.repair45.v1, danach nie wieder. Eine Diagnose-Zeile "repair45 removed N". */
function runRepair45(s: AppState): AppState {
  try {
    if (localStorage.getItem(REPAIR45_KEY)) return s;
    const r = repair45(s, Date.now());
    localStorage.setItem(REPAIR45_KEY, String(Date.now()));
    diagLog.push(`repair45 removed ${r.removed.length}`);
    return r.state;
  } catch {
    return s;
  }
}

export async function saveState(s: AppState): Promise<void> {
  await (await db()).put(STORE, s, KEY);
}

/** Bittet Safari, den Speicher nicht zu räumen (zusätzlich zur Homescreen-Ausnahme). */
export async function requestPersistence(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* optional */
  }
}

export function exportJson(s: AppState): string {
  return JSON.stringify({ app: 'core', exportedAt: new Date().toISOString(), state: s }, null, 1);
}

export function parseImport(text: string): AppState {
  const data = JSON.parse(text) as { app?: string; state?: AppState };
  if (data.app !== 'core' || !data.state || data.state.version !== 1) throw new Error('Not a valid Core backup');
  return { ...emptyState(), ...data.state, settings: { ...emptyState().settings, ...data.state.settings } };
}

/** Gerätespezifisches zum Sync (letzter Kontakt), nicht Teil des Nutzungsstands und nicht im Export */
const META = 'sync-meta';

export async function loadSyncMeta(): Promise<{ lastSync?: number } | undefined> {
  try {
    return (await (await db()).get(STORE, META)) as { lastSync?: number } | undefined;
  } catch {
    return undefined;
  }
}

export async function saveSyncMeta(m: { lastSync: number }): Promise<void> {
  try {
    await (await db()).put(STORE, m, META);
  } catch {
    /* nur Anzeige */
  }
}
