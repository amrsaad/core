import type { Area, Card } from '../types';

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
}

export const DEFAULT_SETTINGS: Settings = {
  dailyRoundLimit: 5,
  areaShares: { brain: 0.55, body: 0.25, beat: 0.2 },
};

export function emptyState(): AppState {
  return { version: 1, seen: {}, topicWeights: {}, saved: {}, reviews: [], rounds: {}, roundsTotal: 0, settings: structuredClone(DEFAULT_SETTINGS) };
}

export const WEIGHT_MIN = 0.3;
export const WEIGHT_MAX = 3.0;
export const FEEDBACK = { more: 1.25, less: 0.8, save: 1.1, skip: 0.95 } as const;

export function adjustWeight(state: AppState, topic: string, factor: number): AppState {
  const w = state.topicWeights[topic] ?? 1;
  const next = Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, w * factor));
  return { ...state, topicWeights: { ...state.topicWeights, [topic]: Number(next.toFixed(4)) } };
}
