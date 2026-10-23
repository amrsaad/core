// Rohdaten des Tages -> Karten -> Verifikations-Gate -> public/cards/
// Aufruf: tsx pipeline/build.ts [--seed]
import { join } from 'node:path';
import type { Area, Card, CardFile, Interests } from '../src/types';
import { writeIndex } from './cards-index';
import { applyQuota, buildCard } from './cards';
import { knownSourceIds } from './fetch/context';
import { checkUrl, pool } from './http';
import { CARDS_DIR, OUT_DIR, readJson, readRaw, ROOT, writeJson, writeRaw, type RawRecord, type SourceName } from './raw';
import { today } from './text';
import { validateCards } from './validate';

const MIN_PASS = 0.8;
/** Täglicher Nachschub pro Bereich (ca. 55/25/20) */
const DAILY_CAP: Record<Area, number> = { brain: 14, body: 6, beat: 4 };

async function main() {
  const seed = process.argv.includes('--seed');
  const date = process.env.CORE_DATE ?? today();
  const interests = readJson<Interests>(join(ROOT, 'content', 'interests.json'), {} as Interests);
  const raws = readRaw(date);
  const createdAt = new Date().toISOString();
  console.log(`Build ${date}: ${raws.length} Rohdatensätze`);
  if (!raws.length) {
    console.error('Abbruch: keine Rohdaten. Alle Fetcher leer, vermutlich Netz- oder API-Problem.');
    process.exit(1);
  }

  const candidates: Card[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const r of raws) {
    const res = buildCard(r, createdAt);
    if ('card' in res) candidates.push(res.card);
    else skipped.push({ id: r.sourceId, reason: res.skip });
  }

  // Regel 1: Quell-URLs in der Pipeline abrufen, Status in den Rohdaten cachen
  const rawById = new Map<string, RawRecord>(raws.map((r) => [r.sourceId, r]));
  const toCheck = candidates.map((c) => rawById.get(c.source.id)!).filter((r) => r.urlStatus !== 200);
  console.log(`URL-Prüfung: ${toCheck.length}`);
  await pool(toCheck, 4, async (r) => {
    r.urlStatus = await checkUrl(r.url);
  }, 150);
  const bySource = new Map<SourceName, RawRecord[]>();
  for (const r of raws) bySource.set(r.source, [...(bySource.get(r.source) ?? []), r]);
  for (const [src, recs] of bySource) writeRaw(src, date, recs);

  const { accepted, rejected } = validateCards(candidates, rawById, knownSourceIds());
  const passRate = candidates.length ? accepted.length / candidates.length : 0;

  const shares = interests.areas;
  // Business-Inbox leer: Anteil geht an KI (über den Brain-Topf automatisch)
  const selected = seed ? applyQuota(accepted, shares) : applyQuota(accepted, shares, DAILY_CAP);

  const failed = candidates.length > 0 && passRate < MIN_PASS;
  const outFile = join(CARDS_DIR, `${date}.json`);
  const prev = readJson<CardFile>(outFile, { date, cards: [] });
  const merged = [...prev.cards, ...selected.filter((c) => !prev.cards.some((p) => p.id === c.id))];
  if (selected.length && !failed) writeJson(outFile, { date, cards: merged } satisfies CardFile);
  const index = writeIndex();

  const count = (cs: Card[]) => Object.fromEntries((['brain', 'body', 'beat'] as Area[]).map((a) => [a, cs.filter((c) => c.area === a).length]));
  const report = {
    date,
    seed,
    candidates: candidates.length,
    accepted: accepted.length,
    rejectedCount: rejected.length,
    passRate: Number(passRate.toFixed(3)),
    selected: selected.length,
    selectedByArea: count(selected),
    total: index.total,
    rejected,
    skippedByBuilder: skipped,
  };
  writeJson(join(OUT_DIR, `rejected-${date}.json`), report);
  console.log(JSON.stringify({ ...report, rejected: undefined, skippedByBuilder: skipped.length }, null, 1));

  if (failed) {
    console.error(`Abbruch: nur ${(passRate * 100).toFixed(1)} % der Kandidaten bestehen (< 80 %). Ein Fetcher ist vermutlich kaputt.`);
    process.exit(1);
  }
}

main();
