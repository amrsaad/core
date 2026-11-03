/**
 * Warmlauf des nächsten YouTube-Moments (Issue 22, Entscheidung 29). Reine Funktionen ohne Browser, damit die Slot-Logik testbar ist.
 *
 * Der Feed hat drei Player im Wechsel (Slot = Moment-Index modulo 3). Zu jedem Zeitpunkt gilt:
 *   A = aktueller Moment (spielt mit Ton)
 *   B = nächster Moment (läuft stumm WARM_MS lang, dann angehalten am Start, YouTube-Einblendung ist dann weg)
 *   C = übernächster Moment (nur erstes Bild, angehalten, wartet auf seine Rolle B)
 * Beim Wisch nach vorn wird B zu A, C zu B (startet jetzt seinen Warmlauf), der alte A wird zu C und lädt den übernächsten.
 */

/** So lange läuft der nächste Moment stumm im unsichtbaren Player, bis die YouTube-Einblendung (Titel, Kanalbild, Teilen, Logo) weg ist */
export const WARM_MS = 3000;
/** Reserve für die Abdeckfläche: YouTube blendet "etwa 3 s" nach PLAYING aus, ein Sprung oder Puffern verschiebt das um Millisekunden */
export const COVER_MARGIN_MS = 300;
/** Kürzere Momente werden nicht warmgelaufen (der Warmlauf würde fast den ganzen Moment verbrauchen) */
export const MIN_WARM_LEN_S = 8;
/** Bei schwachem Netz startet der Player mit kleiner Qualität und schaltet nach so langem stabilem Spiel auf Auto */
export const QUALITY_UP_MS = 5000;
export const SLOTS = 3;

export type Role = 'current' | 'next' | 'after' | 'other';
export type WarmState = 'idle' | 'running' | 'done';

export const slotOf = (j: number, n = SLOTS): number => ((j % n) + n) % n;

/** Rolle des Moments j, wenn der Feed bei idx steht */
export function roleOf(j: number, idx: number): Role {
  const d = j - idx;
  return d === 0 ? 'current' : d === 1 ? 'next' : d === 2 ? 'after' : 'other';
}

/** Rollen der drei Slots bei Position idx, in Slot-Reihenfolge */
export function rolesAt(idx: number): Role[] {
  const out: Role[] = [];
  for (let s = 0; s < SLOTS; s++) {
    const k = (((s - idx) % SLOTS) + SLOTS) % SLOTS;
    out.push(k === 0 ? 'current' : k === 1 ? 'next' : 'after');
  }
  return out;
}

export interface WarmCtx {
  /** Der Moment ist eine YouTube-Einbettung (eigene Streams und Podcasts haben keine Einblendung) */
  youtube: boolean;
  /** Länge des Moments in Sekunden */
  lenS: number;
  text: boolean;
  forYou: boolean;
  recall: boolean;
  /** Seite im Vordergrund (im Hintergrund hält YouTube Player ohnehin an) */
  visible: boolean;
  /** Ein-Player-Modus (Settings): es gibt keinen zweiten Player */
  single: boolean;
}

/** Darf der Moment in dieser Rolle warmlaufen. Nur der nächste, nur YouTube, nur wenn der Feed gerade Video zeigt. */
export function canWarm(role: Role, c: WarmCtx): boolean {
  return role === 'next' && c.youtube && c.lenS >= MIN_WARM_LEN_S && !c.text && !c.forYou && !c.recall && c.visible && !c.single;
}

/** Ein nicht aktueller Player meldet PLAYING: weiterlaufen lassen (Warmlauf) oder sofort anhalten (erstes Bild reicht) */
export function onNonCurrentPlaying(warm: WarmState, role: Role, can: boolean): 'hold' | 'pause' {
  return warm === 'running' && role === 'next' && can ? 'hold' : 'pause';
}

/**
 * Wie lange nach PLAYING die eigene Fläche über Titelbereich und Logo liegt (Millisekunden).
 * Warm fertig: 0, Warmlauf noch aktiv: Rest der WARM_MS, sonst voller Wert, jeweils plus COVER_MARGIN_MS.
 */
export function coverMs(warm: WarmState, warmPlayedMs: number): number {
  if (warm === 'done') return 0;
  if (warm === 'running') {
    const rest = Math.round(WARM_MS - warmPlayedMs);
    return rest > 0 ? rest + COVER_MARGIN_MS : 0;
  }
  return WARM_MS + COVER_MARGIN_MS;
}

export interface SlotView {
  index: number;
  warm: WarmState;
  /** Der Slot war mit diesem Moment schon einmal der aktuelle (dann kein neuer Warmlauf) */
  visited: boolean;
  /** Bisherige Laufzeit des Warmlaufs in ms (nur bei running) */
  warmPlayedMs: number;
}

export interface SwipePlan {
  /** Slot, der der aktuelle wird */
  target: number;
  /** Dauer der Abdeckfläche nach PLAYING (0: keine nötig) */
  coverMs: number;
  /** Slot, der jetzt zum nächsten wird und seinen Warmlauf beginnt, sonst null */
  promote: number | null;
}

/**
 * Was beim Wisch auf next passiert. Vorwärts und rückwärts gleich: Der Zielslot ist immer slotOf(next), der Nachfolger slotOf(next + 1).
 * Nach einem Wisch zurück ist der Zielslot meist leer (er hielt den übernächsten Moment), also kalt mit Abdeckfläche. Der Nachfolger ist dann der
 * Moment, den man gerade verlassen hat: visited, also kein neuer Warmlauf.
 */
export function swipePlan(next: number, views: SlotView[], ctx: (j: number) => WarmCtx): SwipePlan {
  const t = slotOf(next);
  const tv = views[t];
  const tc = ctx(next);
  const cover = tc.youtube && !tc.text ? (tv && tv.index === next ? coverMs(tv.warm, tv.warmPlayedMs) : coverMs('idle', 0)) : 0;
  const j = next + 1;
  const pv = views[slotOf(j)];
  const promote = pv && pv.index === j && pv.warm === 'idle' && !pv.visited && canWarm('next', ctx(j)) ? slotOf(j) : null;
  return { target: t, coverMs: cover, promote };
}

/** Netzart, bei der der Player mit kleiner Qualität startet (navigator.connection.effectiveType) */
export const slowNet = (effectiveType: string | undefined | null): boolean => effectiveType === '3g' || effectiveType === '2g' || effectiveType === 'slow-2g';

export const startQuality = (effectiveType: string | undefined | null): 'small' | undefined => (slowNet(effectiveType) ? 'small' : undefined);

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];

export interface VideoStats {
  n: number;
  median: number | null;
  p90: number | null;
}

/** Median und 90. Perzentil (wie latency.ts: nächster Rang) der Zeiten Wisch bis erstes Bild */
export function videoStats(ms: number[]): VideoStats {
  if (!ms.length) return { n: 0, median: null, p90: null };
  const s = [...ms].sort((a, b) => a - b);
  return { n: s.length, median: quantile(s, 0.5), p90: quantile(s, 0.9) };
}
