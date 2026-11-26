import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppState } from '../state';
import type { SyncAccess } from '../useAppState';
import { loadSyncMeta, saveSyncMeta } from '../db';
import { clearToken, loadToken, saveToken, syncKey } from '../vault';
import { createSync, type Sync, type SyncStatus } from './controller';
import { canon, onlyFeedTimeChanged, syncedChanged, type SyncDoc } from './merge';
import type { DigestLatest } from '../../moments/digest';
import { diagLog } from '../diag';
import { hasFirstPlayed, hasStablePlayed, isFeedLoading, isWeakNet, playGateNow, SYNC_AFTER_STABLE, SYNC_FIRST_MAX_MS, SYNC_STABLE_MS, waitFirstPlay, waitStablePlay } from './firstPlay';

export interface SyncUi {
  status: SyncStatus;
  /** false, wenn das Token nicht wie ein GitHub-Token aussieht oder dieses Gerät den Schlüssel nicht im neuen Format hat */
  setToken(token: string): Promise<boolean>;
  removeToken(): Promise<void>;
  syncNow(): Promise<void>;
}

const IDLE: SyncStatus = { hasToken: false, lastSync: null, error: null, running: false };

/** Hängt den Sync an den App-Zustand. enabled erst, wenn Zustand und Pool-Schlüssel da sind. */
export function useSync(state: AppState | null, access: SyncAccess, enabled: boolean, resolve?: (d: SyncDoc) => SyncDoc): SyncUi {
  const [status, setStatus] = useState<SyncStatus>(IDLE);
  const sync = useRef<Sync | null>(null);
  const prev = useRef<AppState | null>(null);
  // Der Sync wird nicht neu gebaut, wenn sich die Alias-Auflösung ändert: er liest immer die jüngste
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;

  useEffect(() => {
    if (!enabled) return;
    const s = createSync({
      getState: access.getState,
      adopt: access.adopt,
      resolve: (d) => (resolveRef.current ? resolveRef.current(d) : d),
      getKey: syncKey,
      getToken: loadToken,
      // Runde 46 (SYNC_AFTER_STABLE): der erste Upload wartet auf 20 s stabiles Spielen statt auf das erste PLAYING, weitere Uploads nicht in den ersten 5 s eines Moments oder beim Stocken
      firstPlay: SYNC_AFTER_STABLE ? waitStablePlay : waitFirstPlay,
      firstPlayed: SYNC_AFTER_STABLE ? hasStablePlayed : hasFirstPlayed,
      firstWait: SYNC_AFTER_STABLE ? { label: 'stable playback', why: `stable ${SYNC_STABLE_MS / 1000} s`, maxMs: SYNC_FIRST_MAX_MS } : undefined,
      playGate: SYNC_AFTER_STABLE ? () => playGateNow() : undefined,
      uploadBusy: isFeedLoading,
      weakNet: isWeakNet,
      diag: () => diagLog.entries(),
      adoptDigest: (l: DigestLatest) => access.adopt((st) => (st.digestLatest && canon(st.digestLatest) === canon(l) ? st : { ...st, digestLatest: l })),
      loadMeta: loadSyncMeta,
      saveMeta: saveSyncMeta,
      onStatus: setStatus,
    });
    sync.current = s;
    const vis = () => s.visible(document.visibilityState === 'visible');
    const on = () => s.online();
    const off = () => s.offline();
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) s.offline();
    (window as unknown as { __sync?: unknown }).__sync = { status: () => s.status(), syncNow: () => s.syncNow() };
    void s.start();
    return () => {
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      s.stop();
      sync.current = null;
    };
  }, [enabled, access]);

  // Jede Änderung an Synchronisiertem startet die 10 Sekunden von vorn
  useEffect(() => {
    if (!state) return;
    if (prev.current && syncedChanged(prev.current, state)) sync.current?.poke(onlyFeedTimeChanged(prev.current, state));
    prev.current = state;
  }, [state]);

  const setToken = useCallback(async (token: string) => {
    if (!(await saveToken(token))) return false;
    await sync.current?.tokenChanged();
    return true;
  }, []);
  const removeToken = useCallback(async () => {
    await clearToken();
    await sync.current?.tokenChanged();
  }, []);
  const syncNow = useCallback(async () => {
    await sync.current?.syncNow();
  }, []);

  return { status, setToken, removeToken, syncNow };
}
