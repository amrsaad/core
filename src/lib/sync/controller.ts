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
import { CryptoFail, decryptDoc, decryptLatest, encryptDoc, type PackStats } from './crypto';
import { DIGEST_PATH, readRemote, SyncError, writeRemote } from './github';
import type { DigestLatest } from '../../moments/digest';
import { diagLog, type DiagEntry } from '../diag';

export const WRITE_DELAY_MS = 10_000;
/** Offline-Pause: Meldet der Browser das Netz nicht zurück (iOS lässt das online-Ereignis manchmal aus), endet sie nach 5 Minuten von selbst (Issue 45) */
export const PAUSE_MAX_MS = 5 * 60_000;
export const MAX_ATTEMPTS = 4;
/** Runde 12: der erste Upload nach dem Öffnen wartet auf das erste PLAYING, höchstens so lange (ms). Downloads warten nie. */
export const FIRST_WRITE_MAX_MS = 20_000;
/** Unterscheidet sich nur das Diagnose-Protokoll, schreibt der Sync höchstens alle 5 Minuten, sofort beim Verlassen der App und bei Sync now (Entscheidung 31) */
export const DIAG_FLUSH_MS = 5 * 60_000;
/** Wartezeit nach einem Fehler, der sich von selbst erledigen kann: 15 s, 1 min, 5 min, dann alle 5 min (Issue 9) */
export const RETRY_DELAYS = [15_000, 60_000, 5 * 60_000] as const;
export const retryDelay = (fails: number) => RETRY_DELAYS[Math.min(Math.max(1, fails), RETRY_DELAYS.length) - 1];
/**
 * Scheitert das Schreiben ohne Antwort (Zeitlimit oder Netzfehler), geht es schnell weiter, solange die App sichtbar ist: 3 s, 10 s, 30 s, danach 1 min und alle 5 min.
 * Der Nutzer schließt die App oft nach ein bis zwei Minuten, mit 15 s, 1 min, 5 min kam in 80 s kein zweiter Versuch durch (13.11.).
 * Rate-Limit, Serverfehler, 401, 403 und 409 bleiben bei der alten Folge (retryDelay) oder ohne Wiederholung.
 */
export const UPLOAD_RETRY_DELAYS = [3_000, 10_000, 30_000, 60_000, 5 * 60_000] as const;
export const uploadRetryDelay = (step: number) => UPLOAD_RETRY_DELAYS[Math.min(Math.max(1, step), UPLOAD_RETRY_DELAYS.length) - 1];

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
  /** Eine Zeile ins Diagnose-Protokoll (Issue 45). Ohne Angabe geht sie in lib/diag.ts. */
  log?(line: string): void;
  /** Runde 12: löst sich, sobald der erste Audio- oder Video-Moment spielt. Der erste Upload dieser Sitzung wartet darauf (höchstens FIRST_WRITE_MAX_MS), beim Verlassen der App und bei Sync now nie. Ohne Angabe wartet nichts. */
  firstPlay?: () => Promise<void>;
  /** Hat schon ein Moment gespielt? Dann wartet der erste Upload gar nicht. */
  firstPlayed?: () => boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
  loadMeta?: () => Promise<{ lastSync?: number } | undefined>;
  saveMeta?: (m: { lastSync: number }) => Promise<void>;
  onStatus?: (s: SyncStatus) => void;
}

export interface Sync {
  /** Etwas Synchronisiertes hat sich geändert */
  poke(soft?: boolean): void;
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
  const log = deps.log ?? ((line: string) => diagLog.push(line));
  let st: SyncStatus = { hasToken: false, lastSync: null, error: null, running: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let rev = 0;
  let pending = false;
  let fails = 0;
  /** Gescheiterte Schreibversuche ohne Antwort in Folge (bis zum nächsten Erfolg), und der Stand beim letzten Sichtbarwerden: ab dort zählt die schnelle Folge von vorn */
  let putFails = 0;
  let putBase = 0;
  let hidden = false;
  let active: Promise<void> | null = null;
  let again = false;
  let stopped = false;
  /** Offline-Ereignis: keine automatischen Läufe, bis das Netz zurück ist (höchstens PAUSE_MAX_MS, oder bis die App wieder im Vordergrund ist) */
  let paused = false;
  let pausedAt = 0;
  /** Version der zuletzt gelesenen Wochenkarte, damit dieselbe Datei nicht noch einmal entschlüsselt wird */
  let digestSha: string | null = null;
  /** Diagnose: Zeitpunkt des letzten Schreibens mit Protokoll, jüngste Zeile, die schon auf GitHub liegt, und ob beim nächsten Lauf gespült werden soll */
  let lastDiagWrite = -Infinity;
  let lastDiagT = 0;
  let flushDiag = false;
  /** Der erste Upload wartet nicht mehr (er hat gewartet, die App wurde verlassen, oder Sync now) und ein Aufruf, der das Warten gerade beendet */
  let firstWriteOpen = !deps.firstPlay;
  let releaseFirstWrite: ((why: string) => void) | null = null;
  const openFirstWrite = (why: string) => {
    firstWriteOpen = true;
    releaseFirstWrite?.(why);
  };
  /** Wartet vor dem ersten Upload auf das erste PLAYING, höchstens FIRST_WRITE_MAX_MS. Gibt zurück, ob gewartet wurde. */
  async function holdFirstWrite(): Promise<boolean> {
    if (firstWriteOpen || !deps.firstPlay) return false;
    if (deps.firstPlayed?.()) {
      firstWriteOpen = true;
      return false;
    }
    const t0 = now();
    log('sync: first upload waits for first playback');
    const why = await new Promise<string>((res) => {
      const to = setTimeout(() => res('timeout'), FIRST_WRITE_MAX_MS);
      const done = (w: string) => {
        clearTimeout(to);
        releaseFirstWrite = null;
        res(w);
      };
      releaseFirstWrite = done;
      void deps.firstPlay!().then(() => done('playing'), () => done('error'));
    });
    firstWriteOpen = true;
    log(`sync: first upload released (${why}) after ${((now() - t0) / 1000).toFixed(1)} s`);
    return true;
  }
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
      // Runde 12: vor dem ersten Schreiben warten, bis der erste Moment spielt. Lesen und Zusammenführen sind schon geschehen und blieben davon unberührt.
      if (await holdFirstWrite()) if (stopped) return;
      try {
        const stats = { bytes: 0 };
        const pack: PackStats = { raw: 0, packed: 0, compressed: false };
        const body = await encryptDoc(key, merged, pack);
        log(pack.compressed ? `sync: packed ${Math.round(pack.raw / 1000)} kB to ${Math.round(pack.packed / 1000)} kB` : `sync: not packed ${Math.round(pack.raw / 1000)} kB (no gzip here)`);
        const t0 = now();
        await writeRemote(token, body, remote?.sha ?? null, `core state ${new Date(now()).toISOString()}`, deps.fetchImpl, stats);
        log(`sync: PUT ok ${Math.round(stats.bytes / 1000)} kB in ${((now() - t0) / 1000).toFixed(1)} s${putFails > 0 ? ` (try ${putFails + 1})` : ''}`);
        putFails = 0;
        putBase = 0;
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
    if (stopped) return;
    if (paused && !force) {
      if (now() - pausedAt < PAUSE_MAX_MS) return;
      paused = false;
      log('sync: pause ended after 5 min, no online event came');
    }
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
        if (fails > 0) log(`sync: ok again after ${fails} failed ${fails === 1 ? 'run' : 'runs'}`);
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
        // Welche Anfrage scheitert und womit, statt nur "No connection" (Issue 45)
        const fastPut = err.kind === 'offline' && err.where === 'PUT contents';
        if (fastPut) putFails++;
        log(err.bytes ? `${err.diagLine} (${Math.round(err.bytes / 1000)} kB, try ${putFails})` : err.diagLine);
        if (err.retry) {
          fails++;
          clearTimeout(retryTimer);
          // Schnelle Wiederholung nur solange die App sichtbar ist. Verborgen holt visible(true) es sofort nach.
          if (!fastPut) retryTimer = setTimeout(() => void run(), retryDelay(fails));
          else if (!hidden) retryTimer = setTimeout(() => void run(), uploadRetryDelay(putFails - putBase));
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
    poke(soft = false) {
      if (stopped) return;
      rev++;
      pending = true;
      // Weiche Änderung (Nutzungszeit-Tick): startet die Frist nur, wenn keine läuft, schiebt eine laufende nie weiter
      if (soft && timer) return;
      clearTimeout(timer);
      timer = setTimeout(() => void run(), WRITE_DELAY_MS);
    },
    syncNow() {
      flushDiag = true;
      openFirstWrite('sync now');
      return run(true);
    },
    visible(v) {
      if (stopped) return;
      hidden = !v;
      if (v) putBase = putFails;
      // Zurück im Vordergrund gilt eine Offline-Pause nicht mehr: iOS meldet das online-Ereignis nicht immer, die Pause blieb dann für immer (Issue 45).
      // Ist das Netz wirklich weg, scheitert der Lauf und die Wiederholung (15 s, 1 min, 5 min) übernimmt.
      if (v && paused) {
        paused = false;
        fails = 0;
        clearTimers();
        log('sync: pause ended on foreground, no online event came');
      }
      // Beim Verlassen sofort schreiben, was noch wartet. Beim Zurückkommen laden, was das andere Gerät geschrieben hat.
      if (!v && !pending && !timer && !diagUnsynced()) {
        openFirstWrite('app left');
        return;
      }
      if (!v) {
        flushDiag = true;
        openFirstWrite('app left');
      }
      void run();
    },
    offline() {
      if (stopped) return;
      paused = true;
      pausedAt = now();
      // Wartende Schreib- und Wiederholungstimer ruhen. pending bleibt stehen, der Lauf nach der Rückkehr holt alles nach.
      clearTimers();
      log('sync: paused, offline event');
      // Bleibt das online-Ereignis aus, versucht es der Sync nach PAUSE_MAX_MS von selbst (höchstens ein Lauf alle 5 Minuten)
      retryTimer = setTimeout(() => void run(), PAUSE_MAX_MS);
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
