// Mix-Logik des Video-Feeds: Blöcke à 3 Videos gleichen Bereichs, Bereiche nach Anteil, Beat zuerst am Tag.
import type { Area } from '../types';
import type { Video } from '../videoTypes';

export const BLOCK = 3;
export const BRAIN_TOPICS = ['augen', 'ki', 'business', 'varia'];
export const AREAS: Area[] = ['brain', 'body', 'beat'];
const DAY = 86_400_000;

export interface MixPrefs {
  areaShares: Record<Area, number>;
  channelWeights: Record<string, number>;
  mutedChannels: Record<string, string>;
  videoSeen: Record<string, number>;
}

export interface MixCursor {
  /** Blöcke pro Bereich in dieser Sitzung */
  counts: Record<Area, number>;
  brainRot: number;
  firstOfDay: boolean;
  used: Set<string>;
}

export const newCursor = (firstOfDay: boolean): MixCursor => ({ counts: { brain: 0, body: 0, beat: 0 }, brainRot: 0, firstOfDay, used: new Set() });

export function videoScore(v: Video, p: MixPrefs, now: number): number {
  const area = p.areaShares[v.area] ?? 0.33;
  const channel = p.channelWeights[v.channelId] ?? 1;
  const fresh = v.published && now - Date.parse(v.published) < 14 * DAY ? 1.5 : 1;
  return area * channel * fresh;
}

const available = (v: Video, p: MixPrefs, c: MixCursor) => !p.videoSeen[v.id] && !c.used.has(v.id) && !p.mutedChannels[v.channelId];

/** Höchstens 3 Videos, bester Score zuerst, möglichst verschiedene Kanäle im Block */
function pick(cands: Video[], p: MixPrefs, now: number): Video[] {
  const ranked = [...cands].sort((a, b) => videoScore(b, p, now) - videoScore(a, p, now) || (b.published ?? '').localeCompare(a.published ?? ''));
  const out: Video[] = [];
  for (const v of ranked) {
    if (out.length >= BLOCK) break;
    if (!out.some((o) => o.channelId === v.channelId)) out.push(v);
  }
  for (const v of ranked) {
    if (out.length >= BLOCK) break;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

export interface Block { area: Area; topic?: string; videos: Video[] }

/** Nächster Block. Verändert den Cursor. null, wenn nichts mehr verfügbar ist. */
export function nextBlock(pool: Video[], p: MixPrefs, c: MixCursor, now: number): Block | null {
  const free = pool.filter((v) => available(v, p, c));
  const has = (a: Area) => free.some((v) => v.area === a);
  const areas = AREAS.filter((a) => has(a) && (p.areaShares[a] ?? 0) > 0);
  if (!areas.length) return null;
  const total = AREAS.reduce((s, a) => s + c.counts[a], 0);
  let area: Area;
  if (c.firstOfDay && total === 0 && has('beat')) area = 'beat';
  else {
    // Gleichmäßig gewichtetes Round-Robin: Bereich mit dem größten Rückstand auf seinen Anteil
    const sum = areas.reduce((s, a) => s + p.areaShares[a], 0);
    area = areas.reduce((best, a) => {
      const deficit = (x: Area) => (p.areaShares[x] / sum) * (total + 1) - c.counts[x];
      return deficit(a) > deficit(best) ? a : best;
    }, areas[0]);
  }
  let cands = free.filter((v) => v.area === area);
  let topic: string | undefined;
  if (area === 'brain') {
    for (let k = 0; k < BRAIN_TOPICS.length; k++) {
      const t = BRAIN_TOPICS[(c.brainRot + k) % BRAIN_TOPICS.length];
      if (cands.some((v) => v.topic === t)) {
        topic = t;
        break;
      }
    }
    c.brainRot++;
    if (topic) cands = cands.filter((v) => v.topic === topic);
  }
  const videos = pick(cands, p, now);
  c.counts[area]++;
  for (const v of videos) c.used.add(v.id);
  return { area, topic, videos };
}

export function buildQueue(pool: Video[], p: MixPrefs, c: MixCursor, now: number, blocks: number): Block[] {
  const out: Block[] = [];
  for (let i = 0; i < blocks; i++) {
    const b = nextBlock(pool, p, c, now);
    if (!b) break;
    out.push(b);
  }
  return out;
}

export const CHANNEL_MIN = 0.2;
export const CHANNEL_MAX = 3.0;
export const CHANNEL_FEEDBACK = { more: 1.3, less: 0.7, save: 1.1, skip: 0.9 } as const;

export function adjustChannel(weights: Record<string, number>, channelId: string, factor: number): Record<string, number> {
  const w = Math.min(CHANNEL_MAX, Math.max(CHANNEL_MIN, (weights[channelId] ?? 1) * factor));
  return { ...weights, [channelId]: Number(w.toFixed(4)) };
}
