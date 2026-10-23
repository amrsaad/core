import type { Area, Card } from '../types';
import type { Video } from '../videoTypes';
import type { Moment, MomentLogEntry } from '../moments/types';
import type { Weights } from '../moments/mix';

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
  /** Untertitel im Bild */
  captions: boolean;
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
}

export const DEFAULT_SETTINGS: Settings = {
  dailyRoundLimit: 5,
  areaShares: { brain: 0.55, body: 0.25, beat: 0.2 },
  playerMode: 'slots',
  captions: true,
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
