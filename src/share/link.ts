import { formOf, type Form } from '../moments/form';
import { atTime } from '../moments/hook';
import type { Moment } from '../moments/types';
import { langOf, type Lang } from '../moments/focus';

/**
 * Share (Brief 05, Entscheidung 27, Issue 21, Issue 52): Text plus Link zur öffentlichen Clip-Seite.
 * Alles, was die Seite braucht, steht im Link selbst (Fragment, erreicht nie einen Server). Keine Pool-ID, kein Schlüssel, nichts über Max.
 *
 * Issue 52: Der erste echte Link hatte rund 1000 Zeichen, weil die ganze Nutzlast als base64url-JSON im Hash stand. Jetzt trägt der Link
 * nur noch v, form, src, start, end, lang, dir, hook mit kurzen Schlüsseln (v, f, s, a, b, l, d, h), als deflate-raw komprimiert
 * (CompressionStream, iOS 16.4 plus) und base64url. Kontext, Kanal, Folge und Folgenseite stehen im geteilten Text, die Clip-Seite
 * zeigt Hook, Ausschnitt und "Open the original" (aus src abgeleitet). Das erste Zeichen des Hashs sagt, wie er zu lesen ist:
 *   "z" komprimiert, "j" unkomprimiert mit kurzen Schlüsseln (Fallback ohne CompressionStream), alles andere ist das alte Format
 *   (base64url von JSON mit langen Schlüsseln, beginnt immer mit "ey"). Die Clip-Seite liest alle drei.
 * Reine Regeln ohne DOM, geprüft in tests/share-link.test.ts.
 */

/** Inhalt des Moments fürs Teilen. `src` ist die Original-URL der Datei (Audio, eigener Stream, Textquelle) oder die 11-stellige YouTube-ID.
 *  Im Link stehen nur v, form, src, start, end, lang, dir und hook. Die übrigen Felder gehören in den geteilten Text (shareText) und sind beim Lesen eines Links leer. */
export interface ClipPayload {
  v: 1;
  form: Form;
  src: string;
  start: number;
  end: number;
  hook: string;
  /** Zwei Sätze Kontext, bei Text die Passage selbst (Zeilenumbruch je Satz). Nur im Text, nicht im Link. */
  context?: string;
  /** Kanal, nur im Text, nicht im Link */
  channel?: string;
  episode?: string;
  lang: Lang;
  dir: 'ltr' | 'rtl';
  /** Seite der Folge beim Original-Host, wenn sie nicht die Datei selbst ist (Podcast-Seite). Nur im Text. Die Clip-Seite zeigt auf src. */
  url?: string;
}

/** Längste Zeichenkette je Feld beim Lesen eines fremden Links */
export const MAX_FIELD = 2000;
/** Längster Hash, den die Clip-Seite überhaupt anfasst (ein fremder Link könnte sonst beliebig viel entpacken lassen) */
export const MAX_HASH = 8000;

/** Kennung im ersten Zeichen des Hashs */
export const MARK_DEFLATE = 'z';
export const MARK_PLAIN = 'j';

export const isYtId = (s: string) => /^[A-Za-z0-9_-]{11}$/.test(s) && !/^(pod|txt)-/.test(s);

/** Base64url ohne Füllzeichen aus Bytes */
export function b64urlFromBytes(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Base64url ohne Füllzeichen, UTF-8-sicher (Arabisch) */
export const b64urlEncode = (s: string): string => b64urlFromBytes(new TextEncoder().encode(s));
export const b64urlDecode = (s: string): string => new TextDecoder().decode(b64urlToBytes(s));

/** deflate-raw über CompressionStream. Fehlt sie (ältere Browser), kommt null zurück und der Link bleibt unkomprimiert. */
export async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const body = new Response(bytes as BufferSource).body;
    if (!body) return null;
    const out = await new Response(body.pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
    return new Uint8Array(out);
  } catch {
    return null;
  }
}

/** Gegenstück zu deflateRaw. Ohne DecompressionStream oder bei kaputten Daten null. */
export async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const body = new Response(bytes as BufferSource).body;
    if (!body) return null;
    const out = await new Response(body.pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
    return new Uint8Array(out);
  } catch {
    return null;
  }
}

/** Der Inhalt fürs Teilen aus einem Moment. Bei Text ist die Passage der Kontext, die Quelle der Link. */
export function payloadOf(m: Moment): ClipPayload | null {
  const form = formOf(m);
  const lang = langOf(m);
  const src = form === 'text' ? m.sourceUrl : form === 'audio' ? m.hls : isYtId(m.videoId) ? m.videoId : m.hls;
  if (!src) return null;
  const context = form === 'text' ? (m.excerpt?.trim() || m.context?.trim()) : m.context?.trim();
  const p: ClipPayload = {
    v: 1,
    form,
    src,
    start: Math.max(0, Math.floor(m.start)),
    end: Math.max(0, Math.floor(m.end)),
    hook: m.hook.trim(),
    channel: m.channel.trim(),
    lang,
    dir: lang === 'ar' ? 'rtl' : 'ltr',
  };
  if (context) p.context = context;
  if (m.videoTitle?.trim()) p.episode = m.videoTitle.trim();
  if (form !== 'text' && m.url && m.url !== src) p.url = m.url;
  return p;
}

/** Nur die Felder, die in den Link gehören (Issue 52) */
export function linkPayload(p: ClipPayload): ClipPayload {
  return { v: 1, form: p.form, src: p.src, start: p.start, end: p.end, lang: p.lang, dir: p.dir, hook: p.hook };
}

/** JSON mit kurzen Schlüsseln, Reihenfolge fest, damit gleiche Momente gleiche Links ergeben */
export function packLink(p: ClipPayload): string {
  return JSON.stringify({ v: 1, f: p.form, s: p.src, a: p.start, b: p.end, l: p.lang, d: p.dir, h: p.hook });
}

/** Unkomprimierter Hash mit kurzen Schlüsseln ("j…"), synchron. Fallback und Messgröße. */
export const encodePayloadPlain = (p: ClipPayload): string => MARK_PLAIN + b64urlEncode(packLink(p));

/** Hash für den Link: komprimiert ("z…") wenn der Browser CompressionStream hat, sonst unkomprimiert ("j…"). Nimmt die kürzere Form. */
export async function encodePayload(p: ClipPayload): Promise<string> {
  const plain = encodePayloadPlain(p);
  const z = await deflateRaw(new TextEncoder().encode(packLink(p)));
  if (!z) return plain;
  const packed = MARK_DEFLATE + b64urlFromBytes(z);
  return packed.length < plain.length ? packed : plain;
}

/**
 * Prüft ein gelesenes JSON-Objekt (alte lange oder neue kurze Schlüssel) auf Typ und Länge. Die Seite ist öffentlich, ein fremder Link darf nichts einschleusen.
 * Felder, die nicht mehr im Link stehen (context, channel, episode, url), werden aus alten Links weiter gelesen.
 */
export function payloadFromJson(j: unknown, short: boolean): ClipPayload | null {
  if (!j || typeof j !== 'object') return null;
  const o = j as Record<string, unknown>;
  const key = (long: string, s: string) => (short ? s : long);
  const str = (k: string): string | undefined => (typeof o[k] === 'string' && (o[k] as string).length <= MAX_FIELD ? (o[k] as string) : undefined);
  const num = (k: string): number | undefined => (typeof o[k] === 'number' && Number.isFinite(o[k] as number) && (o[k] as number) >= 0 ? (o[k] as number) : undefined);
  const form = str(key('form', 'f'));
  const src = str(key('src', 's'));
  const hook = str(key('hook', 'h'));
  const start = num(key('start', 'a'));
  const end = num(key('end', 'b'));
  if (o.v !== 1 || !form || !['video', 'audio', 'text'].includes(form) || !src || !hook || start === undefined || end === undefined) return null;
  // Nur http(s)-Quellen oder eine YouTube-ID, sonst könnte ein fremder Link javascript: oder data: einschleusen
  if (!/^https?:\/\//i.test(src) && !isYtId(src)) return null;
  const lang = str(key('lang', 'l'));
  const dir = str(key('dir', 'd'));
  const p: ClipPayload = {
    v: 1,
    form: form as Form,
    src,
    start,
    end: Math.max(start, end),
    hook,
    lang: lang === 'ar' || lang === 'de' || lang === 'en' ? lang : 'en',
    dir: dir === 'rtl' ? 'rtl' : 'ltr',
  };
  if (short) return p;
  // Altes Format: die Seite zeigt weiter Kanal, Folge, Caption und Folgenseite, wenn sie im Link stehen
  const channel = str('channel');
  const context = str('context');
  const episode = str('episode');
  const url = str('url');
  if (!channel) return null;
  p.channel = channel;
  if (context) p.context = context;
  if (episode) p.episode = episode;
  if (url && /^https?:\/\//i.test(url)) p.url = url;
  return p;
}

const parseJson = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/** Liest den Link zurück, alle drei Formate. Fremde oder kaputte Hashes ergeben null. */
export async function decodePayload(hash: string): Promise<ClipPayload | null> {
  const raw = hash.replace(/^#/, '').trim();
  if (!raw || raw.length > MAX_HASH || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  const mark = raw[0];
  try {
    if (mark === MARK_DEFLATE) {
      const bytes = await inflateRaw(b64urlToBytes(raw.slice(1)));
      if (!bytes) return null;
      return payloadFromJson(parseJson(new TextDecoder().decode(bytes)), true);
    }
    if (mark === MARK_PLAIN) return payloadFromJson(parseJson(b64urlDecode(raw.slice(1))), true);
    return payloadFromJson(parseJson(b64urlDecode(raw)), false);
  } catch {
    return null;
  }
}

/** Link zur Clip-Seite: Basis-Pfad der laufenden App (Vorschau und echte App bleiben getrennt), Inhalt im Fragment */
export async function clipUrl(p: ClipPayload, origin: string, base: string): Promise<string> {
  const b = base.endsWith('/') ? base : `${base}/`;
  return `${origin}${b}clip/#${await encodePayload(p)}`;
}

/** Anzeige im Share-Blatt: Host, Pfad und der Anfang des Hashs, der Rest ist für Menschen ohne Wert */
export function shortLink(url: string): string {
  const [head, hash = ''] = url.split('#');
  const h = head.replace(/^https?:\/\//, '');
  return hash.length > 12 ? `${h}#${hash.slice(0, 12)}…` : `${h}${hash ? `#${hash}` : ''}`;
}

/**
 * Geteilter Text in der Sprache des Tracks (Entscheidung 23): nur Inhalte des Moments, kein englisches Etikett.
 * Hook, Kontext, dann Kanal, Folge und Zeitstempel in einer Zeile. Der Link kommt getrennt (navigator.share url), beim Kopieren als letzte Zeile.
 */
export function shareText(p: ClipPayload): string {
  const where = [p.channel, p.episode, p.form === 'text' ? '' : atTime(p.start)].filter(Boolean).join(' · ');
  // Bei Text ist der Kontext die Passage selbst, sie steht schon auf der Seite und wäre in der Nachricht doppelt so lang wie nötig
  const ctx = p.form === 'text' ? '' : (p.context ?? '').replace(/\n+/g, ' ').trim();
  return [p.hook, ctx, where].filter(Boolean).join('\n\n');
}

export interface ShareBundle {
  title: string;
  text: string;
  url: string;
}

/** Text und Link zu einem Moment. Asynchron wegen der Kompression des Links. */
export async function shareOf(m: Moment, origin: string, base: string): Promise<ShareBundle | null> {
  const p = payloadOf(m);
  if (!p) return null;
  return { title: p.hook, text: shareText(p), url: await clipUrl(p, origin, base) };
}

/** Link zur ganzen Folge beim Original-Host, für die Clip-Seite */
export function episodeUrlOf(p: ClipPayload): string {
  if (p.form === 'video' && isYtId(p.src)) return `https://www.youtube.com/watch?v=${p.src}&t=${p.start}`;
  if (p.url) return p.url;
  // Direkte Mediendatei: Medienfragment, damit der Browser an der Stelle beginnt
  return p.form === 'text' ? p.src : `${p.src}#t=${p.start}`;
}

/** Absender für die Kopfzeile der Clip-Seite: der Kanal aus alten Links, sonst der Host der Quelle (neue Links tragen keinen Kanal mehr) */
export function sourceLabel(p: ClipPayload): string {
  if (p.channel) return p.channel;
  if (p.form === 'video' && isYtId(p.src)) return 'YouTube';
  try {
    return new URL(p.src).hostname.replace(/^www\./, '');
  } catch {
    return 'Clip';
  }
}
