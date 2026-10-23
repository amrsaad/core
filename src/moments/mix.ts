// Mix der Momente: Blöcke à 3 gleichen Bereichs, Beat zuerst am Tag, Bereichsgewichte lernen mit Untergrenze 10 %,
// 80 % aus Bekanntem mit positivem Gewicht, 20 % Neues, Top-Momente höchstens 1 von 15.
import type { Area } from '../types';
import type { Moment } from './types';

export const BLOCK = 3;
export const AREAS: Area[] = ['brain', 'body', 'beat'];
export const MIN_SHARE = 0.1;
export const EXPLORE = 0.2;
export const TOP_RATE = 1 / 15;

export interface Weights {
  area: Record<string, number>;
  channel: Record<string, number>;
  topic: Record<string, number>;
}

export interface MomentPrefs {
  /** Bereichsanteile aus den Einstellungen */
  areaShares: Record<Area, number>;
  weights: Weights;
  seen: Record<string, number>;
  mutedChannels: Record<string, string>;
}

export interface MomentCursor {
  counts: Record<Area, number>;
  firstOfDay: boolean;
  used: Set<string>;
  /** Picks seit dem letzten Top-Moment */
  sinceTop: number;
}

export const newMomentCursor = (firstOfDay: boolean): MomentCursor => ({ counts: { brain: 0, body: 0, beat: 0 }, firstOfDay, used: new Set(), sinceTop: TOP_RATE ** -1 });

export const W_MIN = 0.2;
export const W_MAX = 3;
export const clampW = (w: number) => Math.min(W_MAX, Math.max(W_MIN, Number(w.toFixed(4))));

export const SIGNAL = { ended: 1.1, skip: 0.9, early: 0.95, mostly: 1.05, back: 1.1, more: 1.3, save: 1.1, negative: 0.7 } as const;

/** Signal beim Weiterwischen nach Anteil des geschauten Moments. null = neutral. */
export function leaveSignal(watchedSec: number, durationSec: number): number | null {
  if (watchedSec < 5) return SIGNAL.skip;
  const f = watchedSec / Math.max(1, durationSec);
  if (f < 0.3) return SIGNAL.early;
  if (f >= 0.8) return SIGNAL.mostly;
  return null;
}

/** Wirkt ein Signal auf Kanal, Topic und (abgeschwächt) Bereich */
export function applySignal(w: Weights, m: Pick<Moment, 'channel' | 'topic' | 'area'>, factor: number, opts: { area?: boolean } = {}): Weights {
  const area = opts.area === false ? w.area : { ...w.area, [m.area]: clampW((w.area[m.area] ?? 1) * Math.sqrt(factor)) };
  return {
    area,
    channel: { ...w.channel, [m.channel]: clampW((w.channel[m.channel] ?? 1) * factor) },
    topic: { ...w.topic, [m.topic]: clampW((w.topic[m.topic] ?? 1) * factor) },
  };
}

/** Wirksame Bereichsanteile: Einstellungen mal gelerntes Gewicht, jeder Bereich mindestens 10 % */
export function effectiveShares(p: Pick<MomentPrefs, 'areaShares' | 'weights'>, areas: Area[] = AREAS): Record<Area, number> {
  const raw = Object.fromEntries(areas.map((a) => [a, Math.max(0, p.areaShares[a] ?? 0) * (p.weights.area[a] ?? 1)])) as Record<Area, number>;
  let sum = areas.reduce((s, a) => s + raw[a], 0) || 1;
  const out = Object.fromEntries(areas.map((a) => [a, raw[a] / sum])) as Record<Area, number>;
  // Untergrenze 10 %: anheben und den Rest proportional kürzen
  for (let k = 0; k < 3; k++) {
    const low = areas.filter((a) => out[a] < MIN_SHARE);
    if (!low.length) break;
    const free = 1 - low.length * MIN_SHARE;
    const highSum = areas.filter((a) => !low.includes(a)).reduce((s, a) => s + out[a], 0) || 1;
    for (const a of areas) out[a] = low.includes(a) ? MIN_SHARE : (out[a] / highSum) * free;
    sum = areas.reduce((s, a) => s + out[a], 0);
  }
  return out;
}

const known = (w: Weights, m: Moment) => m.channel in w.channel || m.topic in w.topic;
const score = (w: Weights, m: Moment) => (w.channel[m.channel] ?? 1) * (w.topic[m.topic] ?? 1);

/** Nächster Block. Verändert den Cursor. null, wenn nichts mehr verfügbar ist. */
export function nextMomentBlock(pool: Moment[], p: MomentPrefs, c: MomentCursor, rng: () => number = Math.random): Moment[] | null {
  const free = pool.filter((m) => !p.seen[m.id] && !c.used.has(m.id) && !p.mutedChannels[m.channel]);
  if (!free.length) return null;
  const areas = AREAS.filter((a) => free.some((m) => m.area === a));
  const total = AREAS.reduce((s, a) => s + c.counts[a], 0);
  let area: Area;
  if (c.firstOfDay && total === 0 && areas.includes('beat')) area = 'beat';
  else {
    const shares = effectiveShares(p, areas);
    area = areas.reduce((best, a) => (shares[a] * (total + 1) - c.counts[a] > shares[best] * (total + 1) - c.counts[best] ? a : best), areas[0]);
  }
  const inArea = free.filter((m) => m.area === area);
  const block: Moment[] = [];
  for (let i = 0; i < BLOCK; i++) {
    const avail = inArea.filter((m) => !block.includes(m));
    if (!avail.length) break;
    const tops = avail.filter((m) => m.top);
    const normal = avail.filter((m) => !m.top);
    let pick: Moment | undefined;
    // Top-Momente selten und unvorhersehbar: höchstens 1 von 15
    if (tops.length && c.sinceTop >= 1 / TOP_RATE && rng() < TOP_RATE * 2) pick = tops[Math.floor(rng() * tops.length)];
    if (!pick) {
      const pool2 = normal.length ? normal : avail;
      const fresh = pool2.filter((m) => !known(p.weights, m));
      const positive = pool2.filter((m) => known(p.weights, m) && score(p.weights, m) >= 1);
      const fromNew = fresh.length && (rng() < EXPLORE || !positive.length);
      const cands = fromNew ? fresh : positive.length ? positive : pool2;
      // Gewichtet zufällig, verschiedene Kanäle im Block bevorzugt
      const weighted = cands.map((m) => ({ m, w: score(p.weights, m) * (block.some((b) => b.channel === m.channel) ? 0.3 : 1) }));
      let r = rng() * weighted.reduce((s, x) => s + x.w, 0);
      pick = weighted.find((x) => (r -= x.w) <= 0)?.m ?? weighted[weighted.length - 1]?.m;
    }
    if (!pick) break;
    c.sinceTop = pick.top ? 0 : c.sinceTop + 1;
    block.push(pick);
  }
  c.counts[area]++;
  for (const m of block) c.used.add(m.id);
  return block;
}
