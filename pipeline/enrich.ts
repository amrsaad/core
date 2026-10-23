// Enrichment, nur in Claude-Code-Sessions (kein API-Key, keine Kosten).
//
//   npm run enrich              -> schreibt pipeline/enrich/todo.json (Karten ohne forYou/recall)
//   (Claude schreibt pipeline/enrich/done-*.json: [{ id, forYou?, recall?: {q,a}, reflection? }])
//   npm run enrich -- apply     -> übernimmt alle done-*.json, prüft jede Karte erneut durch den Validator
//
// Regeln für Claude: nur aus source.excerpt ableitbar, 1 Satz, plain, Deutsch, keine Gedankenstriche,
// jede Zahl muss im Excerpt stehen. Beat: nur reflection (eine offene Frage), keine Auslegung.
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Card, CardFile } from '../src/types';
import { writeIndex } from './cards-index';
import { CARDS_DIR, readAllRaw, readJson, ROOT, writeJson } from './raw';
import { checkCard } from './validate';

const DIR = join(ROOT, 'pipeline', 'enrich');

type Patch = { id: string; forYou?: string; recall?: { q: string; a: string }; reflection?: string };

function cardFiles(): string[] {
  return readdirSync(CARDS_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
}

function exportTodo() {
  const todo: { id: string; area: string; topic: string; type: string; headline: string; excerpt: string; source: string; needs: string[] }[] = [];
  for (const f of cardFiles()) {
    for (const c of readJson<CardFile>(join(CARDS_DIR, f), { date: '', cards: [] }).cards) {
      const needs = c.area === 'beat' ? (c.reflection && c.reflection !== 'Was nimmst du heute aus diesem Vers mit?' ? [] : ['reflection']) : [!c.forYou && 'forYou', !c.recall && 'recall'].filter(Boolean) as string[];
      if (needs.length) todo.push({ id: c.id, area: c.area, topic: c.topic, type: c.type, headline: c.headline, excerpt: c.source.excerpt, source: `${c.source.publisher}: ${c.source.title}`, needs });
    }
  }
  writeJson(join(DIR, 'todo.json'), todo);
  console.log(`${todo.length} Karten brauchen Enrichment -> pipeline/enrich/todo.json`);
}

function apply() {
  if (!existsSync(DIR)) return console.log('Kein pipeline/enrich/ vorhanden.');
  const patches = new Map<string, Patch>();
  const doneFiles = readdirSync(DIR).filter((f) => /^done-.*\.json$/.test(f));
  for (const f of doneFiles) for (const p of readJson<Patch[]>(join(DIR, f), [])) patches.set(p.id, p);
  // Excerpt, für den das Enrichment geschrieben wurde (aus todo*.json). Hat sich der Excerpt seitdem geändert, wird es verworfen.
  const writtenFor = new Map<string, string>();
  for (const f of readdirSync(DIR).filter((n) => /^todo.*\.json$/.test(n))) for (const t of readJson<{ id: string; excerpt: string }[]>(join(DIR, f), [])) writtenFor.set(t.id, t.excerpt);
  const raws = readAllRaw();
  let ok = 0;
  const failed: { id: string; reason: string }[] = [];
  for (const f of cardFiles()) {
    const path = join(CARDS_DIR, f);
    const file = readJson<CardFile>(path, { date: '', cards: [] });
    let changed = false;
    file.cards = file.cards.map((c): Card => {
      const p = patches.get(c.id);
      if (!p) return c;
      if (writtenFor.get(c.id) !== c.source.excerpt) {
        failed.push({ id: c.id, reason: 'Excerpt hat sich seit dem Enrichment geändert' });
        return c;
      }
      const next: Card = { ...c };
      if (c.area === 'beat') {
        if (p.reflection) next.reflection = p.reflection.trim();
      } else {
        if (p.forYou) next.forYou = p.forYou.trim();
        if (p.recall) next.recall = { q: p.recall.q.trim(), a: p.recall.a.trim() };
      }
      // Re-Validierung: Duplikat-Regel hier ausgenommen (Karte existiert bereits)
      const rej = checkCard(next, raws.get(c.source.id), new Set());
      if (rej) {
        failed.push({ id: c.id, reason: rej.reason });
        return c;
      }
      ok++;
      changed = true;
      return next;
    });
    if (changed) writeJson(path, file);
  }
  writeJson(join(ROOT, 'pipeline', 'out', 'enrich-rejected.json'), failed);
  for (const f of doneFiles) rmSync(join(DIR, f));
  writeIndex();
  console.log(`Enrichment übernommen: ${ok}, verworfen: ${failed.length} (pipeline/out/enrich-rejected.json)`);
}

if (process.argv.includes('apply')) apply();
else exportTodo();
