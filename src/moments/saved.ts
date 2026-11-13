// Gemerkte Momente werden nur als Verweis gespeichert (Runde 11): ein kleiner stub statt des ganzen Moments.
// Anzeigen und Abspielen kommen aus dem Pool. Das Altformat (moment im Eintrag) bleibt lesbar, bis der Pool den Moment kennt.
import type { SavedMoment, SavedStub } from '../lib/state';
import { fullVideoUrl, type Moment } from './types';

type PoolById = ReadonlyMap<string, Moment>;

const HOOK_MAX = 120;
const CHANNEL_MAX = 30;
const TITLE_MAX = 60;
const URL_MAX = 100;

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Kleiner Rest eines Moments. Lange Texte werden gekürzt, damit der Eintrag unter 400 Byte bleibt. Eine zu lange URL entfällt (ein gekürzter Link wäre falsch). */
export function stubOf(m: Moment): SavedStub {
  const url = fullVideoUrl(m);
  const out: SavedStub = { id: m.id, hook: cut(m.hook ?? '', HOOK_MAX) };
  if (m.channel) out.channel = cut(m.channel, CHANNEL_MAX);
  if (m.videoTitle) out.videoTitle = cut(m.videoTitle, TITLE_MAX);
  if (url && url.length <= URL_MAX) out.url = url;
  if (m.area) out.area = m.area;
  if (m.form) out.form = m.form;
  if (typeof m.start === 'number') out.start = m.start;
  if (typeof m.end === 'number') out.end = m.end;
  return out;
}

/** Neuer Eintrag beim Merken: nur der stub, kein moment */
export const newSaved = (m: Moment, savedAt: string): SavedMoment => ({ stub: stubOf(m), savedAt });

/** Moment zum Anzeigen und Abspielen: Pool-Eintrag, sonst Altformat im Eintrag, sonst null. Wirft nie. */
export function resolveSaved(entry: SavedMoment | undefined | null, id: string, poolById: PoolById): Moment | null {
  return poolById.get(id) ?? entry?.moment ?? null;
}

/** Felder für die Liste, auch wenn der Moment nicht mehr im Pool ist */
export interface SavedView {
  id: string;
  moment: Moment | null;
  hook: string;
  channel: string;
  videoTitle: string;
  area: string | undefined;
  /** Link zur Quelle, falls bekannt */
  url: string | undefined;
}

export function savedView(entry: SavedMoment, id: string, poolById: PoolById): SavedView {
  const m = resolveSaved(entry, id, poolById);
  const st = entry.stub;
  return {
    id,
    moment: m,
    hook: m?.hook ?? st?.hook ?? '',
    channel: m?.channel ?? st?.channel ?? '',
    videoTitle: m?.videoTitle ?? st?.videoTitle ?? '',
    area: m?.area ?? st?.area,
    url: m ? fullVideoUrl(m) : st?.url,
  };
}

/**
 * Alte Einträge verkleinern: moment durch stub ersetzen, wenn die ID im Pool ist. Ohne Pool-Treffer bleibt moment (sonst ginge Inhalt verloren).
 * Rein. Ändert sich nichts, kommt dasselbe Objekt zurück (kein Schreiben, kein Upload). Zweiter Lauf ändert nichts.
 */
export function slimSaved(saved: Record<string, SavedMoment>, poolById: PoolById): Record<string, SavedMoment> {
  if (!poolById.size) return saved;
  let out: Record<string, SavedMoment> | null = null;
  for (const [id, e] of Object.entries(saved)) {
    if (!e || !e.moment || !poolById.has(id)) continue;
    const { moment, ...rest } = e;
    out ??= { ...saved };
    out[id] = { ...rest, stub: e.stub ?? stubOf(moment) };
  }
  return out ?? saved;
}

/** Zahl der Einträge mit Altformat, für die Diagnosezeile */
export const countSlimmable = (saved: Record<string, SavedMoment>, poolById: PoolById) => Object.entries(saved).filter(([id, e]) => !!e?.moment && poolById.has(id)).length;
