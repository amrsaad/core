import type { Area, Card } from '../types';
import type { Video } from '../videoTypes';
import type { Moment, MomentLogEntry } from '../moments/types';
import type { Weights } from '../moments/mix';
import type { LatencySample } from '../moments/latency';
import type { CaptionMode } from '../moments/captions';
import type { DayCount } from '../moments/today';
import type { Form } from '../moments/form';
import type { RecallState } from '../moments/recall';

export interface SavedItem {
  card: Card;
  savedAt: string;
  /** ts-fsrs Card, Datumsfelder als ISO-String */
  fsrs: Record<string, unknown>;
}

export interface Review {
  id: string;
  ts: string;
  /** true = gewusst (Gut/Leicht bzw. "Gewusst") */
  hit: boolean;
  kind: 'fsrs' | 'quiz';
}

export interface Settings {
  dailyRoundLimit: number;
  areaShares: Record<Area, number>;
  /** 'slots': 3 recycelte Player. 'single': ein Player, loadVideoById in der Wischgeste (iOS-Fallback) */
  playerMode: 'slots' | 'single';
  /** Untertitel im Bild (alter Video-Feed v2) */
  captions: boolean;
  /** Untertitel der Momente: auto (Regel Punkt 4), immer an, immer aus. Fehlt in alten Ständen, dann auto */
  captionMode?: CaptionMode;
  /** Darreichungsform im Feed (Punkt 3). Fehlt in alten Ständen, dann video */
  form?: Form;
  /** Wiedergabetempo (Fundament-Regel 11: Standard 1,5x, Option 2x, nie 2,5x). Fehlt in alten Ständen, dann gilt DEFAULT_SPEED */
  playbackSpeed?: 1 | 1.5 | 2;
}

export interface SavedMoment {
  moment: Moment;
  savedAt: string;
  /** im Wochenrückblick als umgesetzt markiert */
  done?: boolean;
}

export interface SavedVideo {
  video: Video;
  savedAt: string;
}

export interface AppState {
  version: 1;
  seen: Record<string, number>;
  topicWeights: Record<string, number>;
  saved: Record<string, SavedItem>;
  reviews: Review[];
  /** abgeschlossene Runden pro lokalem Tag */
  rounds: Record<string, number>;
  /** Gesamtzahl abgeschlossener Runden, steuert die Brain-Rotation */
  roundsTotal: number;
  settings: Settings;
  // Video-Feed (v2)
  videoSeen: Record<string, number>;
  channelWeights: Record<string, number>;
  /** channelId -> Kanalname */
  mutedChannels: Record<string, string>;
  savedVideos: Record<string, SavedVideo>;
  /** Feed-Zeit in ms pro lokalem Tag */
  feedTime: Record<string, number>;
  /** Tage, an denen der 30-Minuten-Hinweis schon kam */
  limitShown: Record<string, boolean>;
  /** Letzter Tag mit Video-Feed, für "erster Block des Tages = Beat" */
  videoDay?: string;
  // Experten-Momente (v4)
  momentSeen: Record<string, number>;
  momentWeights: Weights;
  savedMoments: Record<string, SavedMoment>;
  /** letzte Wiedergaben für Signale und Wochenrückblick */
  momentLog: MomentLogEntry[];
  momentDay?: string;
  /** Wochen (Montag als YYYY-MM-DD), in denen der Rückblick schon kam */
  weekReviewShown: Record<string, boolean>;
  /** Diagnose: Wisch bis erstes Bild, letzte Messungen (Bauliste Runde 1, Punkt 1) */
  playLatency?: LatencySample[];
  /** Tageszahl pro lokalem Tag (Punkt 6) */
  dayCount?: Record<string, DayCount>;
  /** Abrufkarten: Ergebnisse und Wiedervorlage (Punkt 5) */
  recall?: RecallState;
}

export const DEFAULT_SPEED = 1.5;
/** Gedrückt halten (wie Reels). Nie schneller als 2x (Fundament-Regel 11, Murphy et al. 2022) */
export const HOLD_SPEED = 2;
export const MAX_SPEED = 2;
/** Einstellbar laut Bauliste Runde 1, Punkt 2: 1x und 1,5x. 2x nur per Halten */
export const SPEED_OPTIONS = [1, 1.5] as const;
export type Speed = (typeof SPEED_OPTIONS)[number];
/** Gespeichertes Tempo, alte Stände (2x aus dem Zwischenstand vom 26.10.) fallen auf den Standard zurück */
export const speedOf = (s: Pick<Settings, 'playbackSpeed'>): Speed => ((SPEED_OPTIONS as readonly number[]).includes(s.playbackSpeed ?? -1) ? (s.playbackSpeed as Speed) : DEFAULT_SPEED);
export const clampRate = (r: number) => Math.min(MAX_SPEED, Math.max(0.25, r));

export const DEFAULT_SETTINGS: Settings = {
  dailyRoundLimit: 5,
  areaShares: { brain: 1 / 3, body: 1 / 3, beat: 1 / 3 },
  playerMode: 'slots',
  captions: true,
  captionMode: 'auto',
  playbackSpeed: DEFAULT_SPEED,
};

export function emptyState(): AppState {
  return { version: 1, seen: {}, topicWeights: {}, saved: {}, reviews: [], rounds: {}, roundsTotal: 0, settings: structuredClone(DEFAULT_SETTINGS), videoSeen: {}, channelWeights: {}, mutedChannels: {}, savedVideos: {}, feedTime: {}, limitShown: {}, momentSeen: {}, momentWeights: { area: {}, channel: {}, topic: {} }, savedMoments: {}, momentLog: [], weekReviewShown: {} };
}

export const WEIGHT_MIN = 0.3;
export const WEIGHT_MAX = 3.0;
export const FEEDBACK = { more: 1.25, less: 0.8, save: 1.1, skip: 0.95 } as const;

export function adjustWeight(state: AppState, topic: string, factor: number): AppState {
  const w = state.topicWeights[topic] ?? 1;
  const next = Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, w * factor));
  return { ...state, topicWeights: { ...state.topicWeights, [topic]: Number(next.toFixed(4)) } };
}
