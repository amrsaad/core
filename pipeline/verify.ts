// Prüft den gesamten veröffentlichten Bestand erneut durch das Gate (inkl. Enrichment-Felder).
// Aufruf: npm run verify
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Card, CardFile } from '../src/types';
import { CARDS_DIR, readAllRaw, readJson } from './raw';
import { checkCard } from './validate';

const raws = readAllRaw();
const cards: Card[] = readdirSync(CARDS_DIR)
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
  .flatMap((f) => readJson<CardFile>(join(CARDS_DIR, f), { date: '', cards: [] }).cards);
const seen = new Set<string>();
const bad: string[] = [];
for (const c of cards) {
  const r = checkCard(c, raws.get(c.source.id), seen);
  if (r) bad.push(`${c.id}: Regel ${r.rule}, ${r.reason}`);
  seen.add(c.source.id);
  for (const t of [c.forYou, c.recall?.q, c.recall?.a, c.reflection]) if (t && /[—–]/.test(t)) bad.push(`${c.id}: Gedankenstrich im Enrichment`);
}
const enriched = cards.filter((c) => (c.area === 'beat' ? c.reflection : c.forYou && c.recall)).length;
console.log(`${cards.length} Karten geprüft, ${bad.length} Verstöße, ${enriched} mit Enrichment`);
bad.forEach((b) => console.log(`  ${b}`));
if (bad.length) process.exit(1);
