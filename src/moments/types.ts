import type { Area } from '../types';

export type Kind = 'story' | 'regel' | 'entscheidung' | 'mechanismus' | 'zahl';

/** Veröffentlichte Felder eines Moments (Belege bleiben im privaten Repo) */
/** Abfragefrage zum Ausschnitt (Max, 26.10.): Anwendungsfrage, drei Antworten, eine richtig. Arabische Momente: Frage und Antworten auf Arabisch. */
export interface Recall {
  question: string;
  options: [string, string, string];
  /** Index 0 bis 2 in options */
  correct: 0 | 1 | 2;
  why: string;
}

export interface Moment {
  id: string;
  videoId: string;
  start: number;
  end: number;
  channel: string;
  videoTitle: string;
  area: Area;
  topic: string;
  hook: string;
  forYou?: string;
  /** Kontext zur Stelle, zwei Sätze (Entscheidung 18 in core-content). Fehlt das Feld, wird nichts angezeigt. */
  context?: string;
  kind: Kind;
  recall?: Recall;
  /** Core Digest (Know oder Rule): Abrufkarte nach 1, 4 und 14 Tagen statt 2, 7 und 21 */
  recallBoost?: boolean;
  /** Inhaltsstrom: video, audio oder text. Erbt von der Quelle in registry.json. Fehlt das Feld: audio true heißt audio, sonst video. Text-Momente haben keinen Player. */
  form?: 'video' | 'audio' | 'text';
  top?: boolean;
  createdAt: string;
  /** Eigener Stream statt YouTube (z.B. TED), Vorschaubild und Originalseite */
  hls?: string;
  thumb?: string;
  url?: string;
  /** Nur Ton (Podcast): Bild bleibt stehen, Untertitel groß in der Mitte */
  audio?: boolean;
  /** Untertitel [Sekunden ab start, Text] */
  cues?: [number, string][];
  /** Nur form text: Quelle der Passage, Namensnennung und Link in der App */
  sourceUrl?: string;
  license?: string;
  author?: string;
  /** Fundstelle in der Quelle, z.B. "Quran 94:5" oder "Hadith 12" */
  ref?: string;
  /** Ausschnitt als Text für die Textform, Satzgrenzen (Arabisch: Sprechpausen) als Zeilenumbruch */
  excerpt?: string;
  /** Frühere IDs dieses Moments (Neueinordnung im Audio, Issue 7). Gespeicherte Stände mit alter ID werden auf die aktuelle umgestellt, siehe aliases.ts. */
  aliases?: string[];
}

export interface MomentPool {
  updatedAt: string;
  lastRun: string | null;
  moments: Moment[];
}

export type Feedback = 'mehr' | 'kenne' | 'schwach' | 'falsch';

export interface MomentLogEntry {
  id: string;
  day: string;
  /** bis end geschaut */
  ended: boolean;
  /** Sekunden bis zum Weiterwischen */
  watched: number;
  feedback?: Feedback;
}

export const thumbOf = (m: { videoId: string; thumb?: string }) => m.thumb ?? `https://i.ytimg.com/vi/${m.videoId}/hqdefault.jpg`;
/** Quelle des Moments. YouTube nur bei echter YouTube-ID, sonst url (Podcast, Stream) oder sourceUrl (Text). Ohne beides: keine Quelle. */
export const fullVideoUrl = (m: { videoId: string; start: number; url?: string; sourceUrl?: string }): string | undefined => {
  if (m.url) return m.url;
  if (m.sourceUrl) return m.sourceUrl;
  if (/^[A-Za-z0-9_-]{11}$/.test(m.videoId) && !/^(pod|txt)-/.test(m.videoId)) return `https://www.youtube.com/watch?v=${m.videoId}&t=${Math.floor(m.start)}`;
  return undefined;
};

/** Untertitel in arabischer Schrift werden rechtsläufig gesetzt */
export const isArabic = (s: string) => /[\u0600-\u06FF]/.test(s);
