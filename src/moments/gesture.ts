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
