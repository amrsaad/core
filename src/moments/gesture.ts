// Erste Geste irgendwo im Dokument (Issue 13, Punkt 1): pointerdown, pointerup, touchend, click oder Taste, auch auf den Reitern und der Leiste.
// Sie schaltet den Ton frei, nicht nur ein Tipp im Feed. Das Modul hört einmal je Seite im Capture, Abonnenten bekommen jede Geste und wissen,
// ob es die erste war. iOS zählt erst touchend und click als Aktivierung für Ton, darum laufen alle Ereignisse durch dieselbe Freischaltung.

export interface Gesture {
  /** Erste Geste dieser Seite */
  first: boolean;
  type: string;
  /** pointerId der Berührung, -1 ohne */
  pointerId: number;
}

type Listener = (g: Gesture) => void;

const subs = new Set<Listener>();
let seen = false;
let firstPointer = -1;
let installed = false;

/** Hat es auf dieser Seite schon eine Geste gegeben? Ein neu gebauter Feed (Reiterwechsel) übernimmt den Ton daraus. */
export const gestureSeen = (): boolean => seen;
/** pointerId der ersten Berührung: Das Loslassen derselben Berührung im Feed ist kein Pausentipp */
export const firstGesturePointer = (): number => firstPointer;
export const clearFirstGesturePointer = (): void => {
  firstPointer = -1;
};

export function onGesture(f: Listener): () => void {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}

/** Eine Geste melden (Listener des Dokuments, Tests) */
export function emitGesture(type: string, pointerId = -1): Gesture {
  const first = !seen;
  seen = true;
  if (first) firstPointer = pointerId;
  const g: Gesture = { first, type, pointerId };
  for (const f of [...subs]) {
    try {
      f(g);
    } catch {
      /* ein Abonnent darf die anderen nicht stören */
    }
  }
  return g;
}

const TYPES = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;

export function installGestures(doc: Document = document): () => void {
  if (installed) return () => {};
  installed = true;
  const on = (e: Event) => emitGesture(e.type, typeof (e as PointerEvent).pointerId === 'number' ? (e as PointerEvent).pointerId : -1);
  for (const t of TYPES) doc.addEventListener(t, on, { capture: true, passive: true });
  return () => {
    for (const t of TYPES) doc.removeEventListener(t, on, { capture: true });
    installed = false;
  };
}

/** Nur Tests: Zustand zurücksetzen */
export function resetGesturesForTest(): void {
  seen = false;
  firstPointer = -1;
  subs.clear();
}

// ---------- Einhändig (Entscheidung 54, Brief 16): waagerechter Wisch auf dem Moment wechselt den Reiter ----------
// Reihenfolge der Reiter wie in der Kopfzeile. Links (dx negativ) heißt nächster Reiter, rechts heißt voriger. Am Rand passiert nichts.
// Ein Wisch zählt waagerecht ab 60 px und nur, wenn er flacher als 30 Grad läuft. Alles Steilere ist ein senkrechter Wisch (Moment weiter oder zurück).

/** Wischweg in px, ab dem ein waagerechter Wisch den Reiter wechselt */
export const TAB_SWIPE_PX = 60;
/** Größter Winkel zur Waagerechten in Grad, bis zu dem ein Wisch als waagerecht gilt */
export const TAB_SWIPE_DEG = 30;
const TAN_LIMIT = Math.tan((TAB_SWIPE_DEG * Math.PI) / 180);

/** Läuft der Wisch flacher als 30 Grad? Entscheidet die Achse, sobald der Finger sich bewegt hat. */
export const isFlat = (dx: number, dy: number): boolean => Math.abs(dx) > 0 && Math.abs(dy) <= Math.abs(dx) * TAN_LIMIT;

export type TabSwipe = 'tabNext' | 'tabPrev' | null;

/** Waagerechter Wisch: ab 60 px und flacher als 30 Grad. Links ist der nächste Reiter, rechts der vorige. */
export function tabSwipe(dx: number, dy: number): TabSwipe {
  if (Math.abs(dx) < TAB_SWIPE_PX || !isFlat(dx, dy)) return null;
  return dx < 0 ? 'tabNext' : 'tabPrev';
}

/** Der Reiter nach dem Wisch, oder null am Rand der Reihe (kein Umlauf, sonst springt der Finger von Text zurück auf Video) */
export function tabAfterSwipe<T>(order: readonly T[], current: T, sw: TabSwipe): T | null {
  if (!sw) return null;
  const i = order.indexOf(current);
  if (i < 0) return null;
  const j = sw === 'tabNext' ? i + 1 : i - 1;
  return j >= 0 && j < order.length ? order[j] : null;
}
