import type { Area, Card } from '../types';
import type { Video } from '../videoTypes';
import type { Moment, MomentLogEntry } from '../moments/types';
import type { Weights } from '../moments/mix';
import type { LatencySample } from '../moments/latency';
import type { TapSample } from '../moments/actions';
import type { FrameSample } from '../moments/swipe';
import type { CaptionMode } from '../moments/captions';
import type { DayCount } from '../moments/today';
import type { Form } from '../moments/form';
import type { RecallState } from '../moments/recall';
import type { Signals } from '../moments/signals';
import type { QueueEntry } from '../moments/recallqueue';
import type { WeekPlan } from '../moments/review';
import type { NoteEntry } from '../moments/note';
import type { TapLog } from '../moments/learn';
import type { DigestLatest, DigestTaps } from '../moments/digest';
import type { DiagEntry } from './diag';

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
  /** Wiedergabetempo (Pfeiler 17): 1x, 1.5x, 2x, nie darüber. Langes Drücken schaltet im Kreis, per Sync auf allen Geräten. Fehlt in alten Ständen, dann 1x */
  playbackRate?: Rate;
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
  /** Zähler für "n-mal in k Tagen" (Weak, Not for me je Unterthema, Skips je Folge), siehe learn.ts. Nur an diesem Gerät, wandert nicht. */
  tapLog?: TapLog;
  /** Version der Lernregeln, nach der die Gewichte zuletzt umgestellt wurden (learn.ts LEARN_VERSION). Fehlt sie, steht die einmalige Anhebung noch aus. */
  learnVersion?: number;
  savedMoments: Record<string, SavedMoment>;
  /** letzte Wiedergaben für Signale und Wochenrückblick */
  momentLog: MomentLogEntry[];
  momentDay?: string;
  /** Wochen (Montag als YYYY-MM-DD), in denen der Rückblick schon kam */
  weekReviewShown: Record<string, boolean>;
  /** Diagnose: Wisch bis erstes Bild, letzte Messungen (Bauliste Runde 1, Punkt 1) */
  playLatency?: LatencySample[];
  /** Tipp bis Füllung am Knopf, letzte Messungen (Aufgabe 3) */
  tapMs?: TapSample[];
  /** Swipe frame drops: je Wisch verlorene Frames von Aufsetzen bis 600 ms nach dem Loslassen, letzte Messungen (nur dieses Gerät) */
  swipeFrames?: FrameSample[];
  /** Momente mit gefülltem Herz (More like this) */
  momentLiked?: Record<string, number>;
  /** Momente, zu denen Ask benutzt wurde: Moment-ID auf askedAt (ms). Wandert per Sync, der Digest liest es. */
  momentAsked?: Record<string, number>;
  /** Rückmeldung: jede Notiz (Chip oder Text) wird lokal gesammelt und einmal am Tag gesammelt als Issue gesendet */
  feedbackNotes?: NoteEntry[];
  /** Tag (lokal), an dem die Zeile "N notes, send?" zuletzt gezeigt wurde */
  notesPromptDay?: string;
  /** Tageszahl pro lokalem Tag (Punkt 6) */
  dayCount?: Record<string, DayCount>;
  /** Abrufkarten: Ergebnisse und Wiedervorlage (Punkt 5) */
  recall?: RecallState;
  /** Signale für Digest und Kontext (Brief 03): Tageszähler mixClump, byHour, coldNetStarts und missed, siehe moments/signals.ts. Wandert per Sync. */
  signals?: Signals;
  /** Entscheidung 36: Position je Reiter (ID des Moments, bei dem der Reiter verlassen wurde). Nur an diesem Gerät. */
  tabCursor?: Partial<Record<'video' | 'audio' | 'text', { id: string; day: string }>>;
  /** Wie oft ein Moment Startmoment eines Reiters war (höchstens 2). Nur an diesem Gerät. */
  startShown?: Record<string, number>;
  /** Schnelle Skips (vor 5 s weggewischt) je Moment. Zwei davon heißen abgelehnt. Nur an diesem Gerät. */
  momentSkips?: Record<string, number>;
  /** Abgelehnte Momente (Entscheidung 36): ID auf Zeitpunkt. Sie stehen auch in momentSeen. Per Sync, frühester Zeitpunkt. */
  momentRejected?: Record<string, number>;
  /** Entscheidung 45 (Reparatur): Momente, deren Eintrag in momentSeen gelöscht wurde, weil sie nie gespielt haben. ID auf Zeitpunkt der Löschung.
   *  Ein Eintrag in momentSeen, der nicht jünger ist als dieser Zeitpunkt, gilt nicht. Per Sync, spätester Zeitpunkt (hält die Löschung gegen das andere Gerät). */
  momentUnseen?: Record<string, number>;
  /** Wenn-dann-Plan pro Woche (Montag als YYYY-MM-DD), Punkt 7 */
  plans?: Record<string, WeekPlan>;
  /** Desktop-Modus: die Übersicht der Tasten wurde beim ersten Start schon gezeigt */
  deskHelpSeen?: boolean;
  /** Core Digest: Taps auf der Wochenkarte (a:<id> Done oder Drop, c:<id> Option A oder B). Wandern per Sync, der nächste Lauf sammelt sie ein. */
  digestTaps?: DigestTaps;
  /** Core Digest: zuletzt geladene Wochenkarte (state/digest-latest.enc). Nur an diesem Gerät, kommt bei jedem Sync neu. */
  digestLatest?: DigestLatest;
  /** Pfeiler 19: fällige Abrufkarten, die nicht gezeigt werden durften (Hintergrund, Settings, Blatt). Höchstens 3, per Sync. */
  recallQueue?: QueueEntry[];
  /** Entscheidung 31 (Wache): Diagnose-Zeilen aller Geräte, Ringpuffer mit 500 Zeilen (Zeit, Gerät, Text), Merge nach Zeit, siehe lib/diag.ts. Löst keinen Sync aus, geht beim nächsten Schreiben mit. */
  diag?: DiagEntry[];
  /** Geräte-Sync: Zeitpunkt der letzten Änderung je Schlüssel (Gewichte, Gemerktes, Herzen, Stumme, Pläne, Einstellungen), siehe lib/sync/merge.ts */
  syncTs?: Record<string, number>;
}

/** Pfeiler 17: Tempo ist eine gespeicherte Einstellung. Der Kreis ist 1x, 1.5x, 2x, 1x. Nie schneller als 2x (Murphy et al. 2022). */
export const RATES = [1, 1.5, 2] as const;
export type Rate = (typeof RATES)[number];
export const DEFAULT_RATE: Rate = 1;
export const MAX_RATE = 2;
/** Gespeichertes Tempo. Fehlende oder unbekannte Werte (auch der alte Schlüssel playbackSpeed) fallen auf 1x zurück */
export const rateOf = (s: Pick<Settings, 'playbackRate'>): Rate => ((RATES as readonly number[]).includes(s.playbackRate ?? -1) ? (s.playbackRate as Rate) : DEFAULT_RATE);
/** Nächster Wert im Kreis: 1x, 1.5x, 2x, 1x */
export const nextRate = (r: Rate): Rate => RATES[(RATES.indexOf(r) + 1) % RATES.length];
export const clampRate = (r: number) => Math.min(MAX_RATE, Math.max(0.25, r));

export const DEFAULT_SETTINGS: Settings = {
  dailyRoundLimit: 5,
  areaShares: { brain: 1 / 3, body: 1 / 3, beat: 1 / 3 },
  playerMode: 'slots',
  captions: true,
  captionMode: 'auto',
  playbackRate: DEFAULT_RATE,
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

// ---------- Reparatur 45 ----------

/** Marker in localStorage: die einmalige Reparatur lief auf diesem Gerät */
export const REPAIR45_KEY = 'core.repair45.v1';
const HUNG_LINE = /^(?:watchdog|skipped \(not seen\)) (\S+)/;

/**
 * Entscheidung 45: Einträge in momentSeen, zu denen kein momentLog-Eintrag mit watched über 0 steht, werden gelöscht (der Moment hat nie gespielt).
 * Dazu die Momente, die die Hänge-Überwachung im Protokoll hat (Zeilen "watchdog" und "skipped (not seen)"), solange sie nie bis zum Ende liefen:
 * watched zählt ab dem Ankommen, ein Moment, der 12 s hing, hat dort schon über 0.
 * Unberührt bleiben abgelehnte Momente, Einträge, die älter sind als das Protokoll (es deckt sie nicht ab), und alles bei leerem Protokoll.
 * Jede Löschung bekommt einen Zeitpunkt in momentUnseen, damit der Sync den Eintrag nicht vom anderen Gerät zurückholt.
 */
export function repair45(s: AppState, now: number): { state: AppState; removed: string[] } {
  if (!s.momentLog.length) return { state: s, removed: [] };
  // Stehen schon Löschmarken im Stand, lief die Reparatur auf diesem oder einem anderen Gerät. Fehlt nur der Marker (localStorage geleert, Gerät neu verbunden),
  // darf sie nicht noch einmal laufen: sonst kommen Momente ein zweites Mal zurück (Issue 45).
  if (s.momentUnseen && Object.keys(s.momentUnseen).length) return { state: s, removed: [] };
  const played = new Set<string>();
  const ended = new Set<string>();
  let first = '';
  for (const e of s.momentLog) {
    if (e.watched > 0) played.add(e.id);
    if (e.ended) ended.add(e.id);
    if (!first || e.day < first) first = e.day;
  }
  const covered = new Date(`${first}T00:00:00`).getTime();
  const hung = new Set<string>();
  for (const d of s.diag ?? []) {
    const m = HUNG_LINE.exec(d.l);
    if (m) hung.add(m[1]);
  }
  const removed = Object.entries(s.momentSeen)
    .filter(([id, at]) => !s.momentRejected?.[id] && at >= covered && (!played.has(id) || (hung.has(id) && !ended.has(id))))
    .map(([id]) => id);
  if (!removed.length) return { state: s, removed };
  const gone = new Set(removed);
  const momentSeen = Object.fromEntries(Object.entries(s.momentSeen).filter(([id]) => !gone.has(id)));
  const momentUnseen = { ...(s.momentUnseen ?? {}), ...Object.fromEntries(removed.map((id) => [id, now])) };
  return { state: { ...s, momentSeen, momentUnseen }, removed };
}
