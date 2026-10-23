import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Area } from '../src/types';
import { htmlToText, normalizeWs } from './text';

export const ROOT = join(import.meta.dirname, '..');
export const RAW_DIR = join(ROOT, 'pipeline', 'raw');
export const CARDS_DIR = join(ROOT, 'public', 'cards');
export const OUT_DIR = join(ROOT, 'pipeline', 'out');

export type SourceName = 'europepmc' | 'arxiv' | 'quran' | 'wikipedia' | 'inbox';

/** Ein abgerufener Datensatz, so wie die Quelle ihn geliefert hat. */
export interface RawRecord {
  sourceId: string; // PMID/DOI/arXiv-ID/Verskey/Wiki-Titel
  source: SourceName;
  area: Area;
  topic: string;
  /** Menschenlesbare Quell-URL, die auf die Karte kommt */
  url: string;
  /** HTTP-Status beim Abruf von url in der Pipeline */
  urlStatus: number;
  /**
   * Maschinen-Endpunkt für denselben Datensatz. Wird geprüft, wenn url den Pipeline-Bot blockt
   * (z.B. PubMed 203/429, Verlage 403). Zählt nur, wenn er HTTP 200 liefert UND genau diese ID enthält.
   */
  verify?: { url: string; mustContain: string };
  /** Status aller geprüften Links */
  urlChecks?: Record<string, number>;
  /** API-Endpunkt und Status, aus dem der Datensatz stammt */
  api: { url: string; status: number };
  title: string;
  publisher: string;
  year?: number;
  /** Rohtexte wie geliefert (HTML/Plain). Der Validator prüft gegen htmlToText() dieser Felder. */
  content: Record<string, string>;
  meta?: Record<string, unknown>;
  fetchedAt: string;
}

export interface RawFile {
  source: SourceName;
  date: string;
  records: RawRecord[];
}

export function plainContent(r: RawRecord, field?: string): string {
  const fields = field ? [field] : Object.keys(r.content);
  return normalizeWs(fields.map((f) => htmlToText(r.content[f] ?? '')).join(' '));
}

export function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 1)}\n`);
}

export function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function writeRaw(source: SourceName, date: string, records: RawRecord[]): void {
  const path = join(RAW_DIR, source, `${date}.json`);
  const prev = readJson<RawFile>(path, { source, date, records: [] });
  const byId = new Map(prev.records.map((r) => [r.sourceId, r]));
  for (const r of records) byId.set(r.sourceId, r);
  writeJson(path, { source, date, records: [...byId.values()] } satisfies RawFile);
}

export function readRaw(date: string): RawRecord[] {
  if (!existsSync(RAW_DIR)) return [];
  const out: RawRecord[] = [];
  for (const src of readdirSync(RAW_DIR)) {
    const f = join(RAW_DIR, src, `${date}.json`);
    if (existsSync(f)) out.push(...readJson<RawFile>(f, { source: src as SourceName, date, records: [] }).records);
  }
  return out;
}

/** Alle Rohdaten aller Tage, nach sourceId (für die Re-Validierung nach Enrichment). */
export function readAllRaw(): Map<string, RawRecord> {
  const map = new Map<string, RawRecord>();
  if (!existsSync(RAW_DIR)) return map;
  for (const src of readdirSync(RAW_DIR)) {
    if (!statSync(join(RAW_DIR, src)).isDirectory()) continue;
    for (const f of readdirSync(join(RAW_DIR, src)).filter((n) => n.endsWith('.json')).sort()) {
      for (const r of readJson<RawFile>(join(RAW_DIR, src, f), { source: src as SourceName, date: '', records: [] }).records) {
        map.set(r.sourceId, r);
      }
    }
  }
  return map;
}
