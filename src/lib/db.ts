import { openDB, type IDBPDatabase } from 'idb';
import { emptyState, type AppState } from './state';

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
    return { ...emptyState(), ...s, settings };
  } catch {
    return emptyState();
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
  if (data.app !== 'core' || !data.state || data.state.version !== 1) throw new Error('Keine gültige Core-Sicherung');
  return { ...emptyState(), ...data.state, settings: { ...emptyState().settings, ...data.state.settings } };
}
