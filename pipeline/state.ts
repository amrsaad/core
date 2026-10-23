import { join } from 'node:path';
import { readJson, ROOT, writeJson } from './raw';

export interface PipelineState {
  quran: { surah: number; ayah: number };
  /** Europe-PMC-Cursor pro fact-Query, damit der tägliche Lauf tiefer in den 5-Jahres-Bestand geht */
  cursors: Record<string, string>;
  lastRun?: string;
}

const PATH = join(ROOT, 'pipeline', 'state.json');

export function loadState(): PipelineState {
  return readJson<PipelineState>(PATH, { quran: { surah: 1, ayah: 1 }, cursors: {} });
}

export function saveState(s: PipelineState): void {
  writeJson(PATH, s);
}
