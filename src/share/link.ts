import { formOf, type Form } from '../moments/form';
import { atTime } from '../moments/hook';
import type { Moment } from '../moments/types';
import { langOf, type Lang } from '../moments/focus';

/**
 * Share (Brief 05, Entscheidung 27, Issue 21): Text plus Link zur öffentlichen Clip-Seite.
 * Alles, was die Seite braucht, steht im Link selbst (Fragment, erreicht nie einen Server). Keine Pool-ID, kein Schlüssel, nichts über Max.
 * Reine Regeln ohne DOM, geprüft in tests/share-link.test.ts.
 */

/** Inhalt des Links. `src` ist die Original-URL der Datei (Audio, eigener Stream, Textquelle) oder die 11-stellige YouTube-ID. */
export interface ClipPayload {
  v: 1;
  form: Form;
  src: string;
  start: number;
  end: number;
  hook: string;
  /** Zwei Sätze Kontext, bei Text die Passage selbst (Zeilenumbruch je Satz) */
  context?: string;
  channel: string;
  episode?: string;
  lang: Lang;
  dir: 'ltr' | 'rtl';
  /** Seite der Folge beim Original-Host, wenn sie nicht die Datei selbst ist (Podcast-Seite). Fehlt sie, zeigt die Clip-Seite auf src. */
  url?: string;
}

/** Längste Zeichenkette je Feld beim Lesen eines fremden Links */
export const MAX_FIELD = 2000;

export const isYtId = (s: string) => /^[A-Za-z0-9_-]{11}$/.test(s) && !/^(pod|txt)-/.test(s);

/** Base64url ohne Füllzeichen, UTF-8-sicher (Arabisch) */
export function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Der Inhalt des Links aus einem Moment. Bei Text ist die Passage der Kontext, die Quelle der Link. */
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

export const encodePayload = (p: ClipPayload): string => b64urlEncode(JSON.stringify(p));

/** Liest den Link zurück. Fremde oder kaputte Hashes ergeben null, Felder werden auf Typ und Länge geprüft (die Seite ist öffentlich). */
export function decodePayload(hash: string): ClipPayload | null {
  const raw = hash.replace(/^#/, '').trim();
  if (!raw || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  let j: unknown;
  try {
    j = JSON.parse(b64urlDecode(raw));
  } catch {
    return null;
  }
  if (!j || typeof j !== 'object') return null;
  const o = j as Record<string, unknown>;
  const str = (k: string): string | undefined => (typeof o[k] === 'string' && (o[k] as string).length <= MAX_FIELD ? (o[k] as string) : undefined);
  const num = (k: string): number | undefined => (typeof o[k] === 'number' && Number.isFinite(o[k] as number) && (o[k] as number) >= 0 ? (o[k] as number) : undefined);
  const form = str('form');
  const src = str('src');
  const hook = str('hook');
  const channel = str('channel');
  const start = num('start');
  const end = num('end');
  if (o.v !== 1 || !form || !['video', 'audio', 'text'].includes(form) || !src || !hook || !channel || start === undefined || end === undefined) return null;
  // Nur http(s)-Quellen oder eine YouTube-ID, sonst könnte ein fremder Link javascript: oder data: einschleusen
  if (!/^https?:\/\//i.test(src) && !isYtId(src)) return null;
  const url = str('url');
  const lang = str('lang');
  const dir = str('dir');
  const p: ClipPayload = {
    v: 1,
    form: form as Form,
    src,
    start,
    end: Math.max(start, end),
    hook,
    channel,
    lang: lang === 'ar' || lang === 'de' || lang === 'en' ? lang : 'en',
    dir: dir === 'rtl' ? 'rtl' : 'ltr',
  };
  const context = str('context');
  const episode = str('episode');
  if (context) p.context = context;
  if (episode) p.episode = episode;
  if (url && /^https?:\/\//i.test(url)) p.url = url;
  return p;
}

/** Link zur Clip-Seite: Basis-Pfad der laufenden App (Vorschau und echte App bleiben getrennt), Inhalt im Fragment */
export function clipUrl(p: ClipPayload, origin: string, base: string): string {
  const b = base.endsWith('/') ? base : `${base}/`;
  return `${origin}${b}clip/#${encodePayload(p)}`;
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

export function shareOf(m: Moment, origin: string, base: string): ShareBundle | null {
  const p = payloadOf(m);
  if (!p) return null;
  return { title: p.hook, text: shareText(p), url: clipUrl(p, origin, base) };
}

/** Link zur ganzen Folge beim Original-Host, für die Clip-Seite */
export function episodeUrlOf(p: ClipPayload): string {
  if (p.form === 'video' && isYtId(p.src)) return `https://www.youtube.com/watch?v=${p.src}&t=${p.start}`;
  if (p.url) return p.url;
  // Direkte Mediendatei: Medienfragment, damit der Browser an der Stelle beginnt
  return p.form === 'text' ? p.src : `${p.src}#t=${p.start}`;
}
