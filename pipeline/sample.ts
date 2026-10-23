// 30 Zufallskarten, Area-gemischt, zur Stichprobe gegen die Quelle.
// Aufruf: npm run sample [-- 30]
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Area, Card, CardFile } from '../src/types';
import { CARDS_DIR, readJson } from './raw';

const n = Number(process.argv[2] ?? 30);
const all: Card[] = readdirSync(CARDS_DIR)
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
  .flatMap((f) => readJson<CardFile>(join(CARDS_DIR, f), { date: '', cards: [] }).cards);
const share: Record<Area, number> = { brain: 0.55, body: 0.25, beat: 0.2 };
const shuffled = [...all].sort(() => Math.random() - 0.5);
const pick: Card[] = [];
for (const a of Object.keys(share) as Area[]) pick.push(...shuffled.filter((c) => c.area === a).slice(0, Math.round(n * share[a])));
pick.forEach((c, i) => {
  console.log(`${i + 1}. [${c.area}/${c.topic}/${c.type}] ${c.headline}`);
  console.log(`   Auszug: "${c.source.excerpt}"`);
  console.log(`   ${c.source.url}\n`);
});
