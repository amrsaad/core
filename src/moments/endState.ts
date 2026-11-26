/**
 * Runde 47: Endseite und Neuaufbau der Warteschlange. Reine Funktionen (Entscheidungen und Diagnosezeilen), ohne React.
 *
 * Hintergrund: Die Endseite steht bei idx = Länge der Warteschlange. Ändert sich dort der Fokus, hat `replanTail` keinen Rest zu planen und
 * brach ab, die Warteschlange wurde nie neu gefüllt. Außerdem blieb ein von `nextMoment` gewählter und dann verworfener Moment (gescheitert,
 * Sitzungs-Sperre) für den Rest der Sitzung in `cursor.used`, auch wenn er ungesehen blieb.
 */
import type { Moment } from './types';

type Id = Pick<Moment, 'id' | 'videoId' | 'channel'>;

/**
 * Fokus gesetzt, geändert oder gelöscht: Liegt hinter dem laufenden Moment nichts mehr (Endseite oder letzter Moment), gibt es keinen Rest
 * zum Neuplanen. Dann wird neu aufgebaut ("refill"), sonst nur der Rest neu gewählt ("keep").
 */
export const focusReplanMode = (queueLen: number, idx: number): 'refill' | 'keep' => (idx + 1 >= queueLen ? 'refill' : 'keep');

/** Ungesehene Momente, die `nextMoment` anbieten darf: nicht gesehen, nicht schon gewählt, Sprecher nicht stumm */
export const freeCount = (pool: readonly Id[], seen: Record<string, number>, muted: Record<string, string>, used: ReadonlySet<string>): number =>
  pool.filter((m) => !seen[m.id] && !used.has(m.id) && !muted[m.channel]).length;

/**
 * Momente, die nur wegen `cursor.used` fehlen: ungesehen, Sprecher nicht stumm, in der Sitzung gewählt, aber nicht in der Warteschlange
 * (gescheitert oder verworfen) und nicht gesperrt. Was in der Warteschlange steht (auch weggewischt), bleibt, sonst käme ein eben
 * weggewischter Moment sofort wieder.
 */
export function discardedIds(pool: readonly Id[], seen: Record<string, number>, muted: Record<string, string>, used: ReadonlySet<string>, queueIds: ReadonlySet<string>, badVideos: ReadonlySet<string>): string[] {
  return pool.filter((m) => !seen[m.id] && !muted[m.channel] && used.has(m.id) && !queueIds.has(m.id) && !badVideos.has(m.videoId)).map((m) => m.id);
}

/** Pille für das Protokoll */
export const focusName = (label: string | null | undefined): string => label || 'none';

export const focusDiagLine = (from: string | null | undefined, to: string | null | undefined, replanFrom: number, tail: number, mode: 'refill' | 'keep'): string =>
  `focus: ${focusName(from)} to ${focusName(to)}, replan from ${replanFrom} tail ${tail} (${mode})`;

export const mixNullLine = (poolLen: number, free: number): string => `mix: null (pool ${poolLen}, free ${free})`;

export interface EndStats {
  form: string;
  /** Momente dieser Form im Pool (auch gesperrte) */
  pool: number;
  seen: number;
  muted: number;
  rejected: number;
  swipeBlocked: number;
  bad: number;
  used: number;
  focus: string | null;
  focusPool: number;
  free: number;
  queue: number;
  idx: number;
}

/**
 * Zählt für die Zeile der Endseite. `formAll` ist der Pool der Form vor dem Abzug der gesperrten (Wischsperre), `formPool` danach, `focused` nach dem Fokus.
 * Die Zahlen sind unabhängig gezählt (ein Moment kann gesehen und stumm zugleich sein).
 */
export function endStats(o: {
  form: string;
  formAll: readonly Id[];
  formPool: readonly Id[];
  focused: readonly Id[];
  seen: Record<string, number>;
  muted: Record<string, string>;
  rejected: Record<string, number> | undefined;
  badVideos: ReadonlySet<string>;
  used: ReadonlySet<string>;
  focus: string | null;
  queue: number;
  idx: number;
}): EndStats {
  return {
    form: o.form,
    pool: o.formAll.length,
    seen: o.formAll.filter((m) => !!o.seen[m.id]).length,
    muted: o.formAll.filter((m) => !!o.muted[m.channel]).length,
    rejected: o.formAll.filter((m) => !!o.rejected?.[m.id]).length,
    swipeBlocked: o.formAll.length - o.formPool.length,
    bad: o.formAll.filter((m) => o.badVideos.has(m.videoId)).length,
    used: o.used.size,
    focus: o.focus,
    focusPool: o.focused.length,
    free: freeCount(o.focused, o.seen, o.muted, o.used),
    queue: o.queue,
    idx: o.idx,
  };
}

export const endDiagLine = (s: EndStats): string =>
  `end: ${s.form} pool ${s.pool}, seen ${s.seen}, muted ${s.muted}, rejected ${s.rejected}, swipe-blocked ${s.swipeBlocked}, session bad ${s.bad}, used ${s.used}, focus ${focusName(s.focus)}, focus-pool ${s.focusPool}, free ${s.free}, queue ${s.queue} idx ${s.idx}`;
