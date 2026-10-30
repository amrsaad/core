// Gemeinsame Text-Helfer für Fetcher, Builder und Validator.

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&[a-z]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}

/** HTML zu Klartext. Fußnoten (<sup>) fliegen raus, Überschriften werden zu "Überschrift: ". */
export function htmlToText(html: string): string {
  return normalizeWs(
    decodeEntities(
      html
        .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, '')
        .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_, h) => ` ${h.trim()}: `)
        .replace(/<(br|\/p|\/div|\/li)[^>]*>/gi, ' ')
        .replace(/<[^>]+>/g, ''),
    ),
  ).replace(/:\s*:/g, ':');
}

export function normalizeWs(s: string): string {
  return s.replace(/[\s ​]+/g, ' ').trim();
}

/** Zahlen-Tokens nach Regel 3: \d+([.,]\d+)?%? , Komma als Dezimaltrenner gleichgesetzt. */
export function numbers(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/\d+([.,]\d+)?\s?%?/g)) out.push(m[0].replace(/\s/g, '').replace(',', '.'));
  return out;
}

/** Satzgrenzen, robust gegen Dezimalzahlen und gängige Abkürzungen. */
export function sentences(text: string): string[] {
  const t = normalizeWs(text);
  const parts: string[] = [];
  let start = 0;
  const re = /[.!?]["')\]]?\s+(?=["'(\[]?[A-ZÄÖÜ0-9؀-ۿ])/g;
  for (const m of t.matchAll(re)) {
    const end = m.index! + m[0].trimEnd().length;
    const before = t.slice(Math.max(start, m.index! - 6), m.index! + 1);
    if (/\b(e\.g|i\.e|vs|et al|approx|Fig|No|Dr|bzw|z\.B|ca|Nr|u\.a|d\.h|St)\.$/i.test(before)) continue;
    parts.push(t.slice(start, end).trim());
    start = end;
  }
  if (start < t.length) parts.push(t.slice(start).trim());
  return parts.filter(Boolean);
}

/** Längster Präfix aus ganzen Sätzen bis max Zeichen. */
export function takeSentences(sents: string[], max: number): string {
  let out = '';
  for (const s of sents) {
    const next = out ? `${out} ${s}` : s;
    if (next.length > max) break;
    out = next;
  }
  return out;
}

/** Kürzt an Satzgrenze, sonst an Teilsatzgrenze (; ,), sonst an Wortgrenze mit Auslassungszeichen. */
export function shorten(text: string, max: number): string {
  const t = normalizeWs(text);
  if (t.length <= max) return t;
  const s = takeSentences(sentences(t), max);
  if (s) return s;
  const cut = t.slice(0, max - 1);
  const clause = Math.max(cut.lastIndexOf(';'), cut.lastIndexOf(','));
  if (clause > max * 0.4) return `${cut.slice(0, clause).trim()} …`;
  const word = cut.lastIndexOf(' ');
  return `${cut.slice(0, word > 0 ? word : cut.length).trim()} …`;
}

export function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
}

export function today(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}
