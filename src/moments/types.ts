import type { Area } from '../types';

export type Kind = 'story' | 'regel' | 'entscheidung' | 'mechanismus' | 'zahl';

/** Veröffentlichte Felder eines Moments (Belege bleiben im privaten Repo) */
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
  kind: Kind;
  top?: boolean;
  createdAt: string;
  /** Eigener Stream statt YouTube (z.B. TED), Vorschaubild und Originalseite */
  hls?: string;
  thumb?: string;
  url?: string;
  /** Form des Moments. Fehlt das Feld: audio true heißt audio, sonst video. Text-Momente haben keinen Player. */
  form?: 'video' | 'audio' | 'text';
  /** Nur Ton (Podcast): Bild bleibt stehen, Untertitel groß in der Mitte */
  audio?: boolean;
  /** Untertitel [Sekunden ab start, Text] */
  cues?: [number, string][];
  /** Ausschnitt als Text für die Textform, Satzgrenzen (Arabisch: Sprechpausen) als Zeilenumbruch */
  excerpt?: string;
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
export const fullVideoUrl = (m: { videoId: string; start: number; url?: string }) => m.url ?? `https://www.youtube.com/watch?v=${m.videoId}&t=${m.start}`;

/** Untertitel in arabischer Schrift werden rechtsläufig gesetzt */
export const isArabic = (s: string) => /[\u0600-\u06FF]/.test(s);
