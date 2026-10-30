// Runde = 12 Karten in Blöcken à 3 Karten gleichen Topics. Position 4, 8, 12 = Abruf, wenn fällig.
import type { Area, Card } from '../types';
import { isDue } from '../lib/fsrs';
import type { AppState, SavedItem } from '../lib/state';

export const ROUND_SIZE = 12;
export const BLOCK_SIZE = 3;
export const RECALL_SLOTS = [3, 7, 11];
const DAY = 86_400_000;

export type RoundItem = { kind: 'card'; card: Card } | { kind: 'recall'; item: SavedItem };

/** Brain rotiert durch drei Gruppen: Augen, KI, Business/Varia */
export const BRAIN_GROUPS: string[][] = [
  ['glaukom', 'retina', 'katarakt', 'refraktiv', 'cornea', 'allgemein'],
  ['ki-medizin', 'ki-regulierung', 'ki-allgemein'],
  ['verhandlung', 'strategie', 'startup', 'varia'],
];

/** Bereichsanteile -> 4 Blöcke (größter Rest), Default 55/25/20 -> 2/1/1 */
export function blocksPerArea(shares: Record<Area, number>, blocks = ROUND_SIZE / BLOCK_SIZE): Record<Area, number> {
  const areas: Area[] = ['brain', 'body', 'beat'];
  const sum = areas.reduce((s, a) => s + shares[a], 0) || 1;
  const raw = areas.map((a) => (shares[a] / sum) * blocks);
  const out = raw.map(Math.floor);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < blocks - out.reduce((s, x) => s + x, 0); k++) out[order[k][1]]++;
  return { brain: out[0], body: out[1], beat: out[2] };
}

export function cardScore(card: Card, state: AppState, now: Date): number {
  if (state.seen[card.id]) return 0;
  const basis = state.settings.areaShares[card.area] ?? 0.33;
  const topic = state.topicWeights[card.topic] ?? 1;
  const fresh = card.type === 'fresh' && now.getTime() - Date.parse(card.createdAt) < 7 * DAY ? 1.5 : 1;
  return basis * topic * fresh;
}

function pickBlock(pool: Card[], state: AppState, now: Date, used: Set<string>, avoidTopics: Set<string>): Card[] {
  const byTopic = new Map<string, Card[]>();
  for (const c of pool) {
    if (used.has(c.id) || state.seen[c.id]) continue;
    byTopic.set(c.topic, [...(byTopic.get(c.topic) ?? []), c]);
  }
  let best: { topic: string; score: number; cards: Card[] } | null = null;
  for (const [topic, cards] of byTopic) {
    const ranked = cards.map((c) => ({ c, s: cardScore(c, state, now) })).sort((a, b) => b.s - a.s || b.c.createdAt.localeCompare(a.c.createdAt));
    const top = ranked.slice(0, BLOCK_SIZE);
    // Volle Blöcke bevorzugen, schon gezeigte Topics dieser Runde meiden
    const score = top.reduce((s, x) => s + x.s, 0) * (top.length >= BLOCK_SIZE ? 1 : 0.3) * (avoidTopics.has(topic) ? 0.2 : 1);
    if (!best || score > best.score) best = { topic, score, cards: top.map((x) => x.c) };
  }
  return best?.cards ?? [];
}

export interface ComposeInput {
  cards: Card[];
  state: AppState;
  now: Date;
  /** Wievielte Runde heute (0 = erste) */
  roundToday: number;
}

export function composeRound({ cards, state, now, roundToday }: ComposeInput): RoundItem[] {
  const blocks = blocksPerArea(state.settings.areaShares);
  const used = new Set<string>();
  const topics = new Set<string>();
  const rot = state.roundsTotal;
  const plan: { area: Area; group?: string[] }[] = [];
  for (let i = 0; i < blocks.brain; i++) plan.push({ area: 'brain', group: BRAIN_GROUPS[(rot + i) % BRAIN_GROUPS.length] });
  for (let i = 0; i < blocks.body; i++) plan.push({ area: 'body' });
  for (let i = 0; i < blocks.beat; i++) plan.push({ area: 'beat' });

  // Reihenfolge: Beat zuerst in der ersten Runde des Tages, sonst Bereiche abwechseln
  const beat = plan.filter((p) => p.area === 'beat');
  const rest = plan.filter((p) => p.area !== 'beat');
  const interleaved: typeof plan = [];
  const brainQ = rest.filter((p) => p.area === 'brain');
  const otherQ = rest.filter((p) => p.area !== 'brain');
  while (brainQ.length || otherQ.length) {
    if (brainQ.length) interleaved.push(brainQ.shift()!);
    if (otherQ.length) interleaved.push(otherQ.shift()!);
  }
  const ordered = roundToday === 0 ? [...beat, ...interleaved] : [...interleaved.slice(0, 1), ...beat, ...interleaved.slice(1)];

  const content: Card[] = [];
  for (const p of ordered) {
    let pool = cards.filter((c) => c.area === p.area && (!p.group || p.group.includes(c.topic)));
    let block = pickBlock(pool, state, now, used, topics);
    // Gruppe leer (z.B. keine Buch-Highlights): andere Brain-Gruppe
    if (!block.length && p.group) {
      pool = cards.filter((c) => c.area === p.area);
      block = pickBlock(pool, state, now, used, topics);
    }
    for (const c of block) used.add(c.id);
    if (block[0]) topics.add(block[0].topic);
    content.push(...block);
  }
  // Auffüllen, falls Blöcke kurz waren
  if (content.length < ROUND_SIZE) {
    const extra = pickBlock(cards, state, now, used, topics);
    for (const c of extra) used.add(c.id);
    content.push(...extra);
  }

  const due = Object.values(state.saved)
    .filter((s) => isDue(s, now))
    .sort((a, b) => String(a.fsrs.due).localeCompare(String(b.fsrs.due)));

  const items: RoundItem[] = [];
  let ci = 0;
  for (let slot = 0; slot < ROUND_SIZE; slot++) {
    if (RECALL_SLOTS.includes(slot) && due.length) {
      items.push({ kind: 'recall', item: due.shift()! });
      continue;
    }
    const c = content[ci++];
    if (c) items.push({ kind: 'card', card: c });
  }
  return items;
}
