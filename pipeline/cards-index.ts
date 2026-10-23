import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CardFile, CardIndex } from '../src/types';
import { CARDS_DIR, readJson, writeJson } from './raw';

export function writeIndex(): CardIndex {
  const files = readdirSync(CARDS_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .map((name) => ({ name, count: readJson<CardFile>(join(CARDS_DIR, name), { date: '', cards: [] }).cards.length }));
  const index: CardIndex = { updatedAt: new Date().toISOString(), files, total: files.reduce((s, f) => s + f.count, 0) };
  writeJson(join(CARDS_DIR, 'index.json'), index);
  return index;
}
