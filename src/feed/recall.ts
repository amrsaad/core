import type { Card } from '../types';

const STOP = new Set(['about', 'after', 'among', 'between', 'during', 'their', 'there', 'these', 'those', 'which', 'while', 'with', 'without', 'versus', 'patients', 'study', 'studies', 'review', 'systematic', 'analysis', 'effects', 'effect', 'outcomes', 'eines', 'einer', 'nicht', 'diese', 'dieser', 'durch', 'werden', 'wurde', 'welche', 'allah']);

/** Abruf-Frage zur Karte: Enrichment, sonst Headline mit ausgeblendetem Schlüsselbegriff. */
export function recallFor(card: Card): { q: string; a: string } {
  if (card.recall) return card.recall;
  const words = card.headline.match(/[\p{L}][\p{L}\p{N}-]{4,}/gu) ?? [];
  const key = [...words].filter((w) => !STOP.has(w.toLowerCase())).sort((a, b) => b.length - a.length)[0];
  if (!key) return { q: `Worum ging es in "${card.source.title}"?`, a: card.headline };
  return { q: card.headline.replace(key, '_____'), a: key };
}
