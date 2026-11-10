import type { IconName } from './icons';

/**
 * Status (Entscheidung 22E und 40, Ergänzung 03.11.): eine Zeile unter den Reitern, ein Zustand zugleich.
 * Vorrang: Offline, Sync-Fehler, Laden, Hintergrund, Stumm. Grün nur für Hintergrund, Orange nur für Sync-Fehler, sonst Grau.
 * Alle anderen Hinweise im Feed entfallen.
 * Brief 12: "Next is ready" ist die Form von Laden, wenn der aktuelle Moment hängt und der nächste schon spielbereit ist (Tipp oder Wisch, kein automatischer Wechsel).
 */
export type StatusKind = 'offline' | 'sync' | 'next' | 'loading' | 'background' | 'muted';

export interface StatusInput {
  offline: boolean;
  /** Fehlertext des letzten Syncs oder null */
  syncError: string | null;
  loading: boolean;
  /** Brief 12: der aktuelle Moment hängt im Netz, der nächste hat sein erstes Bild schon (nur mit loading) */
  nextReady?: boolean;
  /** Ton läuft im Hintergrund weiter (Sperrbildschirm oder anderer Reiter), Einstellung Background audio an */
  background: boolean;
  muted: boolean;
}

export const STATUS_ORDER: StatusKind[] = ['offline', 'sync', 'next', 'loading', 'background', 'muted'];

export function statusOf(i: StatusInput): StatusKind | null {
  if (i.offline) return 'offline';
  if (i.syncError) return 'sync';
  if (i.loading && i.nextReady) return 'next';
  if (i.loading) return 'loading';
  if (i.background) return 'background';
  if (i.muted) return 'muted';
  return null;
}

export const STATUS_TEXT: Record<StatusKind, string> = {
  offline: 'Offline, playing from your device',
  sync: 'Sync failed, will retry',
  next: 'Next is ready',
  loading: 'Loading',
  background: 'Playing in the background',
  muted: 'Sound off, tap to turn on',
};

/** Der Audio-Start aus dem Netz behält den Hinweis zum Bildschirm (iOS hält sonst den Ton an) */
export const STATUS_TEXT_AUDIO_LOADING = 'Loading, keep screen on';

export const STATUS_ICON: Record<StatusKind, IconName> = {
  offline: 'wifi-slash',
  sync: 'warning',
  next: 'arrow-down',
  loading: 'circle-notch',
  background: 'headphones',
  muted: 'speaker-slash',
};

/** Alte Prüfkennungen der E2E-Suiten bleiben je Zustand erhalten */
export const STATUS_TESTID: Record<StatusKind, string> = {
  offline: 'offline',
  sync: 'status-sync',
  next: 'next-ready',
  loading: 'loading-pill',
  background: 'status-background',
  muted: 'sound-off',
};
