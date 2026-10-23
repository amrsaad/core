// Europe PMC REST, ohne Key. Augenheilkunde, KI, Body.
import type { Area } from '../../src/types';
import { getJson } from '../http';
import type { RawRecord } from '../raw';
import { daysAgo, type FetchContext } from './context';

const BASE = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';

const EYE_JOURNALS = ['Ophthalmology', 'JAMA Ophthalmology', 'British Journal of Ophthalmology', 'American Journal of Ophthalmology', 'Retina', 'Progress in Retinal and Eye Research', 'Journal of Cataract and Refractive Surgery'];
const BODY_JOURNALS = ['British Journal of Sports Medicine', 'Sports Medicine', 'Journal of the International Society of Sports Nutrition', 'Medicine and Science in Sports and Exercise', 'Journal of Strength and Conditioning Research'];

const journals = (js: string[]) => `(${js.map((j) => `JOURNAL:"${j}"`).join(' OR ')})`;
const AI = '("artificial intelligence" OR "deep learning" OR "large language model")';
const REVIEW = '(PUB_TYPE:"review" OR PUB_TYPE:"systematic-review" OR PUB_TYPE:"meta-analysis" OR TITLE:"meta-analysis" OR TITLE:"position stand" OR TITLE:"consensus statement")';

interface QueryDef {
  key: string;
  area: Area;
  topic: string;
  q: string;
}

export const QUERIES: QueryDef[] = [
  { key: 'glaukom', area: 'brain', topic: 'glaukom', q: `${journals(EYE_JOURNALS)} AND (glaucoma OR trabeculectomy OR MicroShunt OR "intraocular pressure")` },
  { key: 'retina', area: 'brain', topic: 'retina', q: `${journals(EYE_JOURNALS)} AND ("anti-VEGF" OR macular OR retinal OR retinopathy OR vitrectomy)` },
  { key: 'katarakt', area: 'brain', topic: 'katarakt', q: `${journals(EYE_JOURNALS)} AND (cataract OR phacoemulsification OR "intraocular lens")` },
  { key: 'refraktiv', area: 'brain', topic: 'refraktiv', q: `${journals(EYE_JOURNALS)} AND (SMILE OR LASIK OR myopia OR "refractive surgery")` },
  { key: 'cornea', area: 'brain', topic: 'cornea', q: `${journals(EYE_JOURNALS)} AND (cornea OR corneal OR keratoconus OR keratoplasty OR "dry eye")` },
  { key: 'allgemein', area: 'brain', topic: 'allgemein', q: journals(EYE_JOURNALS) },
  { key: 'ki-medizin', area: 'brain', topic: 'ki-medizin', q: `${AI} AND (ophthalmology OR clinical)` },
  { key: 'ki-regulierung', area: 'brain', topic: 'ki-regulierung', q: `${AI} AND (regulation OR regulatory OR liability)` },
  { key: 'kraft', area: 'body', topic: 'kraft', q: `${journals(BODY_JOURNALS)} AND ("resistance training" OR "strength training" OR hypertrophy OR "muscle strength")` },
  { key: 'ausdauer', area: 'body', topic: 'ausdauer', q: `${journals(BODY_JOURNALS)} AND (endurance OR aerobic OR running OR "VO2max" OR "high-intensity interval")` },
  { key: 'ernaehrung', area: 'body', topic: 'ernaehrung', q: `${journals(BODY_JOURNALS)} AND (nutrition OR protein OR diet OR supplementation OR creatine OR caffeine)` },
  { key: 'recovery', area: 'body', topic: 'recovery', q: `${journals(BODY_JOURNALS)} AND (recovery OR "muscle damage" OR soreness OR "cold water" OR massage)` },
  { key: 'schlaf', area: 'body', topic: 'schlaf', q: `${journals(BODY_JOURNALS)} AND (sleep OR circadian)` },
];

interface EpmcResult {
  id: string;
  source: string;
  pmid?: string;
  doi?: string;
  title?: string;
  abstractText?: string;
  pubYear?: string;
  firstPublicationDate?: string;
  journalInfo?: { journal?: { title?: string }; yearOfPublication?: number };
  pubTypeList?: { pubType?: string[] };
}

interface EpmcResponse {
  hitCount?: number;
  nextCursorMark?: string;
  resultList?: { result?: EpmcResult[] };
}

function buildUrl(q: string, cursor = '*', pageSize = 50): string {
  // Kein sort-Parameter: Europe PMC antwortet darauf mit HTTP 503 (getestet 2026-10-23). Aktualität kommt über FIRST_PDATE.
  const p = new URLSearchParams({ query: q, format: 'json', resultType: 'core', pageSize: String(pageSize), cursorMark: cursor });
  return `${BASE}?${p}`;
}

function toRecord(r: EpmcResult, def: QueryDef, kind: 'fact' | 'fresh', api: { url: string; status: number }, now: string): RawRecord | null {
  if (!r.abstractText || !r.title) return null;
  const types = (r.pubTypeList?.pubType ?? []).map((t) => t.toLowerCase());
  if (types.some((t) => t.includes('retract') || t.includes('erratum') || t.includes('comment') || t.includes('editorial') || t.includes('letter'))) return null;
  const sourceId = r.pmid ? `pmid:${r.pmid}` : r.doi ? `doi:${r.doi.toLowerCase()}` : `epmc:${r.source}:${r.id}`;
  const url = r.pmid ? `https://europepmc.org/article/MED/${r.pmid}` : r.doi ? `https://doi.org/${r.doi}` : `https://europepmc.org/article/${r.source}/${r.id}`;
  return {
    sourceId,
    source: 'europepmc',
    area: def.area,
    topic: def.topic,
    url,
    urlStatus: 0,
    api,
    title: r.title,
    publisher: r.journalInfo?.journal?.title ?? 'Europe PMC',
    year: Number(r.pubYear ?? r.journalInfo?.yearOfPublication) || undefined,
    content: { title: r.title, abstract: r.abstractText },
    meta: { kind, pubTypes: r.pubTypeList?.pubType ?? [], firstPublicationDate: r.firstPublicationDate, doi: r.doi },
    fetchedAt: now,
  };
}

export async function fetchEuropePmc(ctx: FetchContext): Promise<RawRecord[]> {
  const now = new Date().toISOString();
  const byId = new Map<string, RawRecord>();
  const freshFrom = daysAgo(ctx.date, 30);
  const factFrom = daysAgo(ctx.date, 5 * 365);

  for (const def of QUERIES) {
    const runs: { kind: 'fact' | 'fresh'; q: string; pages: number; cursorKey?: string }[] = [
      { kind: 'fresh', q: `${def.q} AND HAS_ABSTRACT:y AND FIRST_PDATE:[${freshFrom} TO ${ctx.date}]`, pages: 1 },
      { kind: 'fact', q: `${def.q} AND ${REVIEW} AND HAS_ABSTRACT:y AND FIRST_PDATE:[${factFrom} TO ${ctx.date}]`, pages: ctx.seed ? 3 : 1, cursorKey: `fact:${def.key}` },
    ];
    for (const run of runs) {
      let cursor = (run.cursorKey && !ctx.seed && ctx.state.cursors[run.cursorKey]) || '*';
      for (let page = 0; page < run.pages; page++) {
        const url = buildUrl(run.q, cursor);
        const res = await getJson<EpmcResponse>(url);
        const results = res.data?.resultList?.result ?? [];
        console.log(`  europepmc ${def.key}/${run.kind} p${page + 1}: HTTP ${res.status}, ${results.length} Treffer`);
        for (const r of results) {
          const rec = toRecord(r, def, run.kind, { url, status: res.status }, now);
          if (rec && !ctx.known.has(rec.sourceId) && !byId.has(rec.sourceId)) byId.set(rec.sourceId, rec);
        }
        const next = res.data?.nextCursorMark;
        if (!next || next === cursor || results.length === 0) {
          if (run.cursorKey) delete ctx.state.cursors[run.cursorKey];
          break;
        }
        cursor = next;
        if (run.cursorKey) ctx.state.cursors[run.cursorKey] = next;
      }
    }
  }

  return [...byId.values()];
}
