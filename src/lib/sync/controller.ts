/**
 * Geräte-Sync (Auftrag Max 28.10.2026). Ablauf:
 * - Beim Start laden und zusammenführen, danach höchstens ein Schreiben, wenn sich etwas unterscheidet.
 * - 10 s nach der letzten Änderung schreiben. Beim Verlassen der App sofort, beim Zurückkommen laden.
 * - Weicht die Version auf GitHub ab (409 oder 422), erst laden, zusammenführen, dann schreiben (bis zu vier Anläufe).
 * - Ohne Netz sammelt die App weiter, der nächste erfolgreiche Lauf holt alles nach (Zusammenführen deckt das ab).
 * - Eine Datei, die nicht entschlüsselt werden kann, wird nie überschrieben.
 * Die Steuerung kennt weder React noch den Browser: Zeit, Netz, Schlüssel und Zustand kommen als Abhängigkeiten.
 */
import type { AppState } from '../state';
import { applyDoc, canon, canonNoDiag, mergeDocs, SYNC_VERSION, toDoc, withDiag, type SyncDoc } from './merge';
import { CryptoFail, decryptDoc, decryptLatest, encryptDoc } from './crypto';
import { DIGEST_PATH, readRemote, SyncError, writeRemote } from './github';
import type { DigestLatest } from '../../moments/digest';
import type { DiagEntry } from '../diag';

export const WRITE_DELAY_MS = 10_000;
export const MAX_ATTEMPTS = 4;
/** Unterscheidet sich nur das Diagnose-Protokoll, schreibt der Sync höchstens alle 5 Minuten, sofort beim Verlassen der App und bei Sync now (Entscheidung 31) */
export const DIAG_FLUSH_MS = 5 * 60_000;
/** Wartezeit nach einem Fehler, der sich von selbst erledigen kann: 15 s, 1 min, 5 min, dann alle 5 min (Issue 9) */
export const RETRY_DELAYS = [15_000, 60_000, 5 * 60_000] as const;
export const retryDelay = (fails: number) => RETRY_DELAYS[Math.min(Math.max(1, fails), RETRY_DELAYS.length) - 1];

export interface SyncStatus {
  hasToken: boolean;
  /** letzter erfolgreicher Kontakt mit GitHub (ms) */
  lastSync: number | null;
  /** eine Zeile, null wenn alles gut */
  error: string | null;
  running: boolean;
}

export interface SyncDeps {
  getState(): AppState | null;
  /** Zustand ohne neue Zeitstempel ändern (Übernahme von GitHub) */
  adopt(fn: (s: AppState) => AppState): void;
  getKey(): Promise<CryptoKey | null>;
  getToken(): Promise<string | null>;
  /** Alte Moment-IDs im Dokument auf aktuelle umstellen (moments/aliases.ts). Wird auf lokalen und fremden Stand angewendet, vor dem Zusammenführen. */
  resolve?: (d: SyncDoc) => SyncDoc;
  /** Core Digest: neue Wochenkarte von GitHub (state/digest-latest.enc). Ohne diese Funktion wird sie nicht geladen. */
  adoptDigest?(latest: DigestLatest): void;
  /** Entscheidung 31: Diagnose-Zeilen dieser Sitzung (lib/diag.ts). Sie gehen in jedes Schreiben mit, auch wenn der Zustand sie noch nicht enthält. */
  diag?(): readonly DiagEntry[];
  fetchImpl?: typeof fetch;
  now?: () => number;
  loadMeta?: () => Promise<{ lastSync?: number } | undefined>;
  saveMeta?: (m: { lastSync: number }) => Promise<void>;
  onStatus?: (s: SyncStatus) => void;
}

export interface Sync {
  /** Etwas Synchronisiertes hat sich geändert */
  poke(): void;
  /** sofort laden, zusammenführen, schreiben */
  syncNow(): Promise<void>;
  /** App kommt in den Vordergrund (true) oder geht (false) */
  visible(v: boolean): void;
  /** Netz ist weg: Sync pausiert (Token, Last sync und lokaler Stand bleiben). Mit syncNow geht es von Hand trotzdem. */
  offline(): void;
  /** Netz ist zurück: Sync läuft sofort wieder an (wie Sync now) */
  online(): void;
  /** Token wurde neu gesetzt oder entfernt */
  tokenChanged(): Promise<void>;
  status(): SyncStatus;
  start(): Promise<void>;
  stop(): void;
}

export function createSync(deps: SyncDeps): Sync {
  const now = deps.now ?? Date.now;
  let st: SyncStatus = { hasToken: false, lastSync: null, error: null, running: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let rev = 0;
  let pending = false;
  let fails = 0;
  let active: Promise<void> | null = null;
  let again = false;
  let stopped = false;
  /** Offline-Ereignis: keine automatischen Läufe, bis das Netz zurück ist */
  let paused = false;
  /** Version der zuletzt gelesenen Wochenkarte, damit dieselbe Datei nicht noch einmal entschlüsselt wird */
  let digestSha: string | null = null;
  /** Diagnose: Zeitpunkt des letzten Schreibens mit Protokoll, jüngste Zeile, die schon auf GitHub liegt, und ob beim nächsten Lauf gespült werden soll */
  let lastDiagWrite = -Infinity;
  let lastDiagT = 0;
  let flushDiag = false;
  const newestT = (l: readonly DiagEntry[]) => l.reduce((m, e) => Math.max(m, e.t), 0);
  const diagUnsynced = () => (deps.diag?.() ?? []).some((e) => e.t > lastDiagT);

  const set = (p: Partial<SyncStatus>) => {
    st = { ...st, ...p };
    deps.onStatus?.(st);
  };

  const clearTimers = () => {
    clearTimeout(timer);
    clearTimeout(retryTimer);
    timer = retryTimer = undefined;
  };

  async function attempt(): Promise<void> {
    const token = await deps.getToken();
    // Ein Token, das eben noch da war und jetzt nicht lesbar ist (Speicher kurz gestört), gilt nie als entfernt:
    // nur tokenChanged() (Nutzer setzt oder entfernt es) ändert hasToken. Hier nur später noch einmal versuchen.
    if (!token && st.hasToken) throw new SyncError('offline', 'The token could not be read just now. Will retry.');
    set({ hasToken: !!token });
    if (!token) {
      set({ error: null });
      return;
    }
    const key = await deps.getKey();
    if (!key) throw new SyncError('setup', 'Sync needs the unlock key on this device. Open your unlock link here once more.');
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const remote = await readRemote(token, deps.fetchImpl);
      const lines = deps.diag?.() ?? [];
      let remoteDoc: SyncDoc | null = null;
      /** Stand auf GitHub, wie er liegt (kann alte IDs haben): nur dann entfällt das Schreiben, wenn der zusammengeführte Stand genau so schon dort liegt */
      let rawKey = '';
      let rawNoDiag = '';
      const fix = (d: SyncDoc) => (deps.resolve ? deps.resolve(d) : d);
      if (remote) {
        try {
          remoteDoc = await decryptDoc(key, remote.text);
        } catch (e) {
          if (e instanceof CryptoFail) throw new SyncError(e.kind, e.message);
          throw e;
        }
        if (remoteDoc.v > SYNC_VERSION) throw new SyncError('format', 'The sync file is from a newer version of Core. Update the app.');
        rawKey = canon(remoteDoc);
        rawNoDiag = canonNoDiag(remoteDoc);
        remoteDoc = fix(remoteDoc);
      }
      const cur = deps.getState();
      if (!cur) return;
      const local = withDiag(fix(toDoc(cur)), lines);
      const merged = remoteDoc ? mergeDocs(local, remoteDoc) : local;
      const mergedKey = canon(merged);
      // Lokal fehlt etwas von GitHub: übernehmen. Die Funktion rechnet gegen den neuesten Zustand, nicht gegen den von eben.
      if (remoteDoc && mergedKey !== canon(local)) {
        const r = remoteDoc;
        deps.adopt((s) => {
          const m = mergeDocs(withDiag(fix(toDoc(s)), lines), r);
          return canon(m) === canon(toDoc(s)) ? s : applyDoc(s, m);
        });
      }
      if (remoteDoc && mergedKey === rawKey) {
        lastDiagT = Math.max(lastDiagT, newestT(lines));
        flushDiag = false;
        return;
      }
      // Unterscheidet sich nur das Protokoll, ist Schreiben nicht dringend (jeder Start und jede Rückkehr würde sonst einen Commit machen)
      if (remoteDoc && canonNoDiag(merged) === rawNoDiag && !flushDiag && now() - lastDiagWrite < DIAG_FLUSH_MS) return;
      try {
        await writeRemote(token, await encryptDoc(key, merged), remote?.sha ?? null, `core state ${new Date(now()).toISOString()}`, deps.fetchImpl);
        lastDiagWrite = now();
        lastDiagT = Math.max(lastDiagT, newestT(lines));
        flushDiag = false;
        return;
      } catch (e) {
        if (e instanceof SyncError && e.kind === 'conflict' && i < MAX_ATTEMPTS - 1) continue;
        if (e instanceof SyncError && e.kind === 'conflict') throw new SyncError('server', 'The sync file keeps changing. Will retry.');
        throw e;
      }
    }
  }

  /** Wochenkarte laden. Sie ist optional: jeder Fehler (kein Netz, Datei fehlt, anderer Schlüssel) lässt den Sync unberührt, der nächste Lauf versucht es erneut. */
  async function loadDigest(): Promise<void> {
    if (!deps.adoptDigest) return;
    try {
      const token = await deps.getToken();
      const key = token ? await deps.getKey() : null;
      if (!token || !key) return;
      const remote = await readRemote(token, deps.fetchImpl, DIGEST_PATH);
      if (!remote || remote.sha === digestSha) return;
      deps.adoptDigest(await decryptLatest(key, remote.text));
      digestSha = remote.sha;
    } catch {
      /* Wochenkarte bleibt, wie sie ist */
    }
  }

  async function run(force = false): Promise<void> {
    if (stopped || (paused && !force)) return;
    if (active) {
      again = true;
      return active;
    }
    clearTimeout(timer);
    const startRev = rev;
    active = (async () => {
      set({ running: true });
      try {
        await attempt();
        await loadDigest();
        fails = 0;
        clearTimeout(retryTimer);
        if (rev === startRev) pending = false;
        if (st.hasToken) {
          const t = now();
          set({ lastSync: t, error: null });
          void deps.saveMeta?.({ lastSync: t });
        }
      } catch (e) {
        const err = e instanceof SyncError ? e : new SyncError('server', 'Sync failed. Will retry.');
        set({ error: err.message });
        if (err.retry) {
          fails++;
          clearTimeout(retryTimer);
          retryTimer = setTimeout(() => void run(), retryDelay(fails));
        }
      } finally {
        set({ running: false });
      }
    })();
    try {
      await active;
    } finally {
      active = null;
    }
    if (again) {
      again = false;
      if (pending) await run();
    }
  }

  return {
    poke() {
      if (stopped) return;
      rev++;
      pending = true;
      clearTimeout(timer);
      timer = setTimeout(() => void run(), WRITE_DELAY_MS);
    },
    syncNow() {
      flushDiag = true;
      return run(true);
    },
    visible(v) {
      if (stopped) return;
      // Beim Verlassen sofort schreiben, was noch wartet. Beim Zurückkommen laden, was das andere Gerät geschrieben hat.
      if (!v && !pending && !timer && !diagUnsynced()) return;
      if (!v) flushDiag = true;
      void run();
    },
    offline() {
      if (stopped) return;
      paused = true;
      // Wartende Schreib- und Wiederholungstimer ruhen. pending bleibt stehen, der Lauf nach der Rückkehr holt alles nach.
      clearTimers();
    },
    online() {
      if (stopped) return;
      paused = false;
      fails = 0;
      clearTimers();
      if (st.hasToken) void run();
    },
    async tokenChanged() {
      fails = 0;
      st = { ...st, error: null };
      const token = await deps.getToken();
      set({ hasToken: !!token, error: null });
      if (token) await run();
    },
    status: () => st,
    async start() {
      stopped = false;
      const meta = await deps.loadMeta?.();
      const token = await deps.getToken();
      set({ hasToken: !!token, lastSync: meta?.lastSync ?? null });
      if (token) await run();
    },
    stop() {
      stopped = true;
      clearTimers();
    },
  };
}
