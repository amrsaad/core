// Verifikations-Gate. Jede Regel ist Ausschluss, Reihenfolge wie in der Spezifikation.
import type { Card } from '../src/types';
import { plainContent, type RawRecord } from './raw';
import { htmlToText, normalizeWs, numbers } from './text';

export interface Rejection {
  id: string;
  rule: number;
  reason: string;
  headline?: string;
}

export interface ValidationResult {
  accepted: Card[];
  rejected: Rejection[];
}

export const LIMITS = { headline: 90, body: 280, excerpt: 400 } as const;

function norm(s: string): string {
  return normalizeWs(htmlToText(s));
}

/** Prüft eine Karte. Gibt null zurück, wenn sie besteht, sonst den Ablehnungsgrund. */
export function checkCard(card: Card, raw: RawRecord | undefined, seen: Set<string>): Rejection | null {
  const rej = (rule: number, reason: string): Rejection => ({ id: card.id, rule, reason, headline: card.headline });

  // 1. URL vorhanden und HTTP 200 beim Abruf
  if (!card.source?.url) return rej(1, 'source.url fehlt');
  if (!raw) return rej(1, `keine Rohdaten für ${card.source.id}`);
  if (raw.urlStatus !== 200) return rej(1, `source.url lieferte HTTP ${raw.urlStatus}`);
  if (raw.url !== card.source.url) return rej(1, 'source.url weicht vom geprüften Link ab');
  if (raw.api.status !== 200) return rej(1, `API lieferte HTTP ${raw.api.status}`);

  // 2. Excerpt ist exakter Substring des Rohtexts
  const rawText = plainContent(raw);
  const excerpt = norm(card.source.excerpt ?? '');
  if (!excerpt) return rej(2, 'source.excerpt leer');
  if (!rawText.includes(excerpt)) return rej(2, 'source.excerpt ist kein exakter Substring des Rohtexts');
  for (const [field, val] of [['arabic', card.arabic], ['translation', card.translation]] as const) {
    if (val && !rawText.includes(norm(val))) return rej(2, `${field} ist nicht wörtlich im Rohtext`);
  }

  // 3. Jede Zahl in headline/body/forYou (und Abruf-Antwort) steht auch im Excerpt
  const allowed = new Set(numbers(excerpt));
  const fields: [string, string | undefined][] = [
    ['headline', card.headline],
    ['body', card.body],
    ['forYou', card.forYou],
    ['recall.q', card.recall?.q],
    ['recall.a', card.recall?.a],
  ];
  for (const [name, val] of fields) {
    if (!val) continue;
    const missing = numbers(val).filter((n) => !allowed.has(n));
    if (missing.length) return rej(3, `Zahl ${missing.join(', ')} in ${name} fehlt im Excerpt`);
  }

  // 4. Längen
  if (!card.headline || card.headline.length > LIMITS.headline) return rej(4, `headline ${card.headline?.length ?? 0} > ${LIMITS.headline} Zeichen`);
  if (card.body && card.body.length > LIMITS.body) return rej(4, `body ${card.body.length} > ${LIMITS.body} Zeichen`);
  if (card.source.excerpt.length > LIMITS.excerpt) return rej(4, `excerpt ${card.source.excerpt.length} > ${LIMITS.excerpt} Zeichen`);

  // 5. Beat: keine eigene Auslegung
  if (card.area === 'beat') {
    if (card.body) {
      const tafsir = normalizeWs(Object.keys(raw.content).filter((k) => k.startsWith('tafsir')).map((k) => plainContent(raw, k)).join(' '));
      if (!tafsir.includes(norm(card.body))) return rej(5, 'Beat-body ist kein wörtlicher Teil des Tafsir');
    }
    if (card.forYou) return rej(5, 'Beat-Karten haben kein forYou (keine eigene Auslegung)');
    if (card.reflection !== undefined && !card.reflection.trim().endsWith('?')) return rej(5, 'reflection muss mit "?" enden');
  } else if (card.reflection) {
    return rej(5, 'reflection nur für Beat');
  }

  // 6. Duplikat über source.id
  if (seen.has(card.source.id)) return rej(6, `Duplikat ${card.source.id}`);
  return null;
}

export function validateCards(cards: Card[], raws: Map<string, RawRecord>, existingIds: Iterable<string> = []): ValidationResult {
  const seen = new Set(existingIds);
  const accepted: Card[] = [];
  const rejected: Rejection[] = [];
  for (const card of cards) {
    const r = checkCard(card, raws.get(card.source?.id), seen);
    if (r) rejected.push(r);
    else {
      accepted.push(card);
      seen.add(card.source.id);
    }
  }
  return { accepted, rejected };
}
