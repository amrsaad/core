// Zeit- und Fehlergrenzen für die Video-Pipeline. Reine Funktionen, ohne Netzzugriff.
import type { Channel } from '../../src/videoTypes';

/** Gesamtbudget des Schritts. Der Workflow-Schritt bricht nach 10 Minuten ab, deshalb endet das Skript vorher und schreibt seinen Stand. */
export const TOTAL_BUDGET_MS = Number(process.env.VIDEO_BUDGET_MS) || 7 * 60_000;
/** Budget je Kanal, damit ein zäher Kanal die anderen nicht verdrängt */
export const CHANNEL_BUDGET_MS = Number(process.env.VIDEO_CHANNEL_BUDGET_MS) || 60_000;
/** Aufeinanderfolgende unklare Antworten (429, 5xx, Timeout), ab denen ein Kanal abgebrochen wird */
export const MAX_UNKNOWN_STREAK = 4;
/** Fehlversuche beim Auflösen, ab denen ein Kanal nur noch selten erneut versucht wird */
export const RESOLVE_MAX_FAILS = 3;
export const RESOLVE_RETRY_DAYS = 7;
/** Höchstens so viele geprüfte Nicht-Shorts je Kanal merken */
export const CHECKED_KEEP = 200;

/** Zusätzliche Felder in content/channels.json, die nur die Pipeline liest */
export type PipeChannel = Channel & {
  /** Video-IDs, die eindeutig kein Short sind. Werden nicht erneut geprüft. */
  checked?: string[];
  /** Zeitpunkt der letzten vollständigen Verarbeitung (für die Reihenfolge im nächsten Lauf) */
  lastRun?: string;
  resolveFails?: number;
  resolveTried?: string;
};

export function budget(ms: number, now: () => number = Date.now) {
  const end = now() + ms;
  return { end, left: () => end - now(), expired: () => now() >= end };
}

/** Kanäle, die am längsten nicht verarbeitet wurden, zuerst. Stabil bei Gleichstand. */
export function orderChannels<T extends PipeChannel>(list: T[]): T[] {
  return list.map((c, i) => ({ c, i })).sort((a, b) => (a.c.lastRun ?? '').localeCompare(b.c.lastRun ?? '') || a.i - b.i).map((x) => x.c);
}

/** Soll ein nicht aufgelöster Kanal in diesem Lauf erneut aufgelöst werden? */
export function shouldResolve(c: PipeChannel, now = Date.now()): boolean {
  if (c.channelId) return false;
  if ((c.resolveFails ?? 0) < RESOLVE_MAX_FAILS || !c.resolveTried) return true;
  return now - Date.parse(c.resolveTried) >= RESOLVE_RETRY_DAYS * 86_400_000;
}

export function noteResolveResult(c: PipeChannel, ok: boolean, nowIso = new Date().toISOString()): void {
  if (ok) {
    delete c.resolveFails;
    delete c.resolveTried;
    return;
  }
  c.resolveFails = (c.resolveFails ?? 0) + 1;
  c.resolveTried = nowIso;
}

/** Zählt unklare Antworten in Folge. Ein klares Ergebnis setzt zurück. */
export function streak(max = MAX_UNKNOWN_STREAK) {
  let n = 0;
  return {
    add(unknown: boolean) {
      n = unknown ? n + 1 : 0;
    },
    tripped: () => n >= max,
  };
}

export function mergeChecked(old: string[] | undefined, fresh: string[], keep = CHECKED_KEEP): string[] {
  return [...new Set([...fresh, ...(old ?? [])])].slice(0, keep);
}
