// Regelbasierte Kartenbildung aus Rohdaten, ohne LLM.
import type { Area, Card, CardType } from '../src/types';
import { plainContent, type RawRecord } from './raw';
import { htmlToText, normalizeWs, numbers, sentences, shorten, takeSentences } from './text';
import { LIMITS } from './validate';

export const DEFAULT_REFLECTION = 'Was nimmst du heute aus diesem Vers mit?';

export type BuildResult = { card: Card } | { skip: string };

const CONCLUSION = /\b(conclusions? and relevance|conclusions?|interpretation|clinical relevance|significance|implications)\s*:\s*/gi;
const APPLY = /\b(recommend|recommended|should|we suggest|is advised|practitioners|coaches|athletes may|can be used to)\b/i;

/** Titel als Headline: ganz, sonst Haupt- oder Untertitel. */
export function headlineFromTitle(title: string): string | null {
  const t = normalizeWs(htmlToText(title)).replace(/\.$/, '');
  if (t.length <= LIMITS.headline) return t;
  for (const part of t.split(/:\s+/)) {
    const p = part.trim().replace(/\.$/, '');
    if (p.length >= 25 && p.length <= LIMITS.headline) return p;
  }
  return null;
}

/** Excerpt: Conclusion-Abschnitt (falls strukturiert), sonst letzter Satz. Immer ganze Sätze, wörtlich. */
export function conclusionExcerpt(abstractPlain: string): string | null {
  const marks = [...abstractPlain.matchAll(CONCLUSION)];
  if (marks.length) {
    const m = marks[marks.length - 1];
    const after = abstractPlain.slice(m.index! + m[0].length);
    const ex = takeSentences(sentences(after), LIMITS.excerpt);
    if (ex) return ex;
  }
  const s = sentences(abstractPlain);
  for (let n = 1; n <= Math.min(3, s.length); n++) {
    const tail = s.slice(-n);
    const ex = tail.join(' ');
    if (ex.length <= LIMITS.excerpt && ex.length >= 60) return ex;
    if (ex.length > LIMITS.excerpt) break;
  }
  const last = s[s.length - 1];
  return last && last.length <= LIMITS.excerpt ? last : null;
}

function base(r: RawRecord, type: CardType, headline: string, excerpt: string, createdAt: string): Card {
  return {
    id: r.sourceId,
    area: r.area,
    topic: r.topic,
    type,
    headline,
    source: { id: r.sourceId, title: normalizeWs(htmlToText(r.title)), publisher: r.publisher, year: r.year, url: r.url, excerpt },
    createdAt,
  };
}

function paperCard(r: RawRecord, createdAt: string): BuildResult {
  const headline = headlineFromTitle(r.title);
  if (!headline) return { skip: 'Titel zu lang für Headline' };
  const excerpt = conclusionExcerpt(plainContent(r, 'abstract'));
  if (!excerpt) return { skip: 'kein Conclusion-Satz unter 400 Zeichen' };
  const nums = new Set(numbers(excerpt));
  if (numbers(headline).some((n) => !nums.has(n))) return { skip: 'Zahl im Titel fehlt im Conclusion-Satz' };
  const kind = (r.meta?.kind as string) === 'fresh' ? 'fresh' : 'fact';
  const type: CardType = r.area === 'body' && APPLY.test(excerpt) ? 'apply' : kind;
  return { card: base(r, type, headline, excerpt, createdAt) };
}

function wikiCard(r: RawRecord, createdAt: string): BuildResult {
  const extract = plainContent(r, 'extract');
  const excerpt = takeSentences(sentences(extract), LIMITS.excerpt);
  if (!excerpt || excerpt.length < 80) return { skip: 'Extract zu kurz oder erster Satz zu lang' };
  const headline = r.title.length <= LIMITS.headline ? r.title : null;
  if (!headline) return { skip: 'Titel zu lang' };
  const nums = new Set(numbers(excerpt));
  if (numbers(headline).some((n) => !nums.has(n))) return { skip: 'Zahl im Titel fehlt im Extract' };
  return { card: base(r, 'fact', headline, excerpt, createdAt) };
}

/** Wörtlicher Anfang bis zum letzten arabischen oder lateinischen Komma vor max. */
export function clausePrefix(text: string, max: number): string {
  const cut = text.slice(0, max);
  const i = Math.max(cut.lastIndexOf('،'), cut.lastIndexOf(','), cut.lastIndexOf('؛'), cut.lastIndexOf(';'));
  return i > max * 0.4 ? cut.slice(0, i + 1).trim() : '';
}

function verseCard(r: RawRecord, createdAt: string): BuildResult {
  const arabic = plainContent(r, 'arabic');
  const translation = plainContent(r, 'translation');
  const muyassar = plainContent(r, 'tafsir_muyassar');
  const ibnKathir = plainContent(r, 'tafsir_ibnkathir');
  if (!arabic || !translation) return { skip: 'Vers oder Übersetzung fehlt' };
  let excerpt = muyassar.length <= LIMITS.excerpt ? muyassar : takeSentences(sentences(muyassar), LIMITS.excerpt) || clausePrefix(muyassar, LIMITS.excerpt);
  let usedIbnKathir = false;
  if (!excerpt) {
    excerpt = takeSentences(sentences(ibnKathir), LIMITS.excerpt);
    usedIbnKathir = true;
  }
  if (!excerpt) return { skip: 'kein Tafsir-Auszug unter 400 Zeichen' };
  const card = base(r, 'verse', shorten(translation, LIMITS.headline), excerpt, createdAt);
  card.arabic = arabic;
  card.translation = translation;
  card.reflection = DEFAULT_REFLECTION;
  card.source.title = `Sure ${String(r.meta?.surahName ?? '')}, ${String(r.meta?.key ?? '')}`;
  if (!usedIbnKathir && ibnKathir) {
    // Body: wörtlicher Anfang von Ibn Kathir, nur Sätze ohne Ziffern (Regel 3)
    const clean: string[] = [];
    for (const s of sentences(ibnKathir)) {
      if (/\d/.test(s)) break;
      clean.push(s);
    }
    const body = takeSentences(clean, LIMITS.body);
    if (body.length >= 40) card.body = body;
  }
  if (numbers(card.headline).some((n) => !new Set(numbers(excerpt)).has(n))) return { skip: 'Ziffer in Übersetzung, nicht im Tafsir-Auszug' };
  return { card };
}

function bookCard(r: RawRecord, createdAt: string): BuildResult {
  const quote = plainContent(r, 'highlight');
  if (quote.length > LIMITS.excerpt) return { skip: 'Highlight über 400 Zeichen' };
  return { card: base(r, 'fact', shorten(quote, LIMITS.headline), quote, createdAt) };
}

export function buildCard(r: RawRecord, createdAt: string): BuildResult {
  switch (r.source) {
    case 'europepmc':
    case 'arxiv':
      return paperCard(r, createdAt);
    case 'wikipedia':
      return wikiCard(r, createdAt);
    case 'quran':
      return verseCard(r, createdAt);
    case 'inbox':
      return bookCard(r, createdAt);
  }
}

/** Round-Robin über Topics, damit ein Topic nicht den Bereich füllt. */
export function pickBalanced(cards: Card[], n: number): Card[] {
  const byTopic = new Map<string, Card[]>();
  for (const c of cards) byTopic.set(c.topic, [...(byTopic.get(c.topic) ?? []), c]);
  const queues = [...byTopic.values()];
  const out: Card[] = [];
  while (out.length < n && queues.some((q) => q.length)) {
    for (const q of queues) {
      const c = q.shift();
      if (c) out.push(c);
      if (out.length >= n) break;
    }
  }
  return out;
}

/** Seed: größte Menge, die die Zielverteilung exakt trifft. */
export function applyQuota(cards: Card[], shares: Record<Area, number>, cap?: Partial<Record<Area, number>>): Card[] {
  const by = (a: Area) => cards.filter((c) => c.area === a);
  const areas = Object.keys(shares) as Area[];
  let out: Card[] = [];
  if (cap) {
    for (const a of areas) out.push(...pickBalanced(by(a), cap[a] ?? Infinity));
    return out;
  }
  const total = Math.floor(Math.min(...areas.map((a) => by(a).length / shares[a])));
  for (const a of areas) out = out.concat(pickBalanced(by(a), Math.round(total * shares[a])));
  return out;
}
