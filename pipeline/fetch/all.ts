// Holt Rohdaten aller Quellen nach pipeline/raw/<quelle>/<datum>.json
// Aufruf: tsx pipeline/fetch/all.ts [--seed] [--only=europepmc,quran]
import { writeRaw, type SourceName, type RawRecord } from '../raw';
import { loadState, saveState } from '../state';
import { today } from '../text';
import { fetchArxiv } from './arxiv';
import { knownSourceIds, type FetchContext } from './context';
import { fetchEuropePmc } from './europepmc';
import { fetchInbox } from './inbox';
import { fetchQuran } from './quran';
import { fetchWikipedia } from './wikipedia';

const FETCHERS: Record<SourceName, (ctx: FetchContext) => Promise<RawRecord[]>> = {
  europepmc: fetchEuropePmc,
  arxiv: fetchArxiv,
  quran: fetchQuran,
  wikipedia: fetchWikipedia,
  inbox: fetchInbox,
};

async function main() {
  const args = process.argv.slice(2);
  const seed = args.includes('--seed');
  const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');
  const date = process.env.CORE_DATE ?? today();
  const state = loadState();
  const ctx: FetchContext = { date, seed, known: knownSourceIds(), state };
  console.log(`Fetch ${date}${seed ? ' (Seed)' : ''}, bekannte Karten: ${ctx.known.size}`);
  const failed: string[] = [];
  for (const [name, fn] of Object.entries(FETCHERS) as [SourceName, (typeof FETCHERS)[SourceName]][]) {
    if (only && !only.includes(name)) continue;
    console.log(`> ${name}`);
    try {
      const recs = await fn(ctx);
      writeRaw(name, date, recs);
      console.log(`  ${name}: ${recs.length} neue Rohdatensätze`);
      if (!recs.length && name !== 'inbox') failed.push(name);
    } catch (e) {
      console.error(`  ${name} fehlgeschlagen:`, e);
      failed.push(name);
    }
  }
  state.lastRun = new Date().toISOString();
  saveState(state);
  if (failed.length) console.warn(`Ohne neue Daten: ${failed.join(', ')}`);
}

main();
