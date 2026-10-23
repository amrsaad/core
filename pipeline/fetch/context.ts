import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CardFile } from '../../src/types';
import { CARDS_DIR, readJson } from '../raw';
import type { PipelineState } from '../state';

export interface FetchContext {
  date: string; // YYYY-MM-DD
  seed: boolean;
  /** source.ids, die schon als Karte existieren: werden nicht erneut geholt */
  known: Set<string>;
  state: PipelineState;
}

export function knownSourceIds(): Set<string> {
  const ids = new Set<string>();
  if (!existsSync(CARDS_DIR)) return ids;
  for (const f of readdirSync(CARDS_DIR)) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(f)) continue;
    for (const c of readJson<CardFile>(join(CARDS_DIR, f), { date: '', cards: [] }).cards) ids.add(c.source.id);
  }
  return ids;
}

export function daysAgo(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
