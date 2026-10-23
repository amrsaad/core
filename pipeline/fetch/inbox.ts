// Buch-Highlights aus content/inbox/books/*.md
// Format pro Highlight:
//   > Zitat (darf über mehrere ">"-Zeilen gehen)
//   Quelle: Titel, Autor, Kapitel
//   Topic: verhandlung | strategie | startup   (optional, Default strategie)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, type RawRecord } from '../raw';
import { normalizeWs, slug } from '../text';
import type { FetchContext } from './context';

export const INBOX = join(ROOT, 'content', 'inbox', 'books');
const TOPICS = new Set(['verhandlung', 'strategie', 'startup']);

export interface Highlight { quote: string; title: string; author: string; chapter?: string; topic: string }

export function parseHighlights(md: string): Highlight[] {
  const out: Highlight[] = [];
  const blocks = md.split(/\n\s*\n/);
  let pending: string[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const quoteLines = lines.filter((l) => l.startsWith('>')).map((l) => l.replace(/^>\s?/, ''));
    if (quoteLines.length) pending = quoteLines;
    const src = lines.find((l) => /^quelle:/i.test(l));
    if (src && pending.length) {
      const [title, author, ...rest] = src.replace(/^quelle:\s*/i, '').split(',').map((s) => s.trim());
      const topicLine = lines.find((l) => /^topic:/i.test(l))?.replace(/^topic:\s*/i, '').trim().toLowerCase();
      out.push({ quote: normalizeWs(pending.join(' ')), title: title ?? '', author: author ?? '', chapter: rest.join(', ') || undefined, topic: topicLine && TOPICS.has(topicLine) ? topicLine : 'strategie' });
      pending = [];
    }
  }
  return out.filter((h) => h.quote && h.title);
}

export async function fetchInbox(ctx: FetchContext): Promise<RawRecord[]> {
  if (!existsSync(INBOX)) return [];
  const now = new Date().toISOString();
  const out: RawRecord[] = [];
  for (const f of readdirSync(INBOX).filter((n) => n.endsWith('.md') && n.toLowerCase() !== 'readme.md')) {
    const md = readFileSync(join(INBOX, f), 'utf8');
    for (const h of parseHighlights(md)) {
      const sourceId = `book:${slug(h.title)}:${slug(h.quote).slice(0, 48)}`;
      if (ctx.known.has(sourceId)) continue;
      // Bücher haben keine eigene URL: Link auf den Open-Library-Eintrag zur Prüfung
      const url = `https://openlibrary.org/search?q=${encodeURIComponent(`${h.title} ${h.author}`)}`;
      out.push({
        sourceId,
        source: 'inbox',
        area: 'brain',
        topic: h.topic,
        url,
        urlStatus: 0,
        api: { url: `file:content/inbox/books/${f}`, status: 200 },
        title: [h.title, h.author, h.chapter].filter(Boolean).join(', '),
        publisher: h.author || 'Buch',
        content: { highlight: h.quote },
        meta: { kind: 'fact', file: f },
        fetchedAt: now,
      });
    }
  }
  console.log(`  inbox: ${out.length} neue Highlights`);
  return out;
}
