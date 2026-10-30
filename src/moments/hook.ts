/**
 * Hook und Caption (Aufgabe 4, Max 27.10.2026). Der Hook wird nie gekürzt. Bis zu drei Zeilen in Normalgröße,
 * bei mehr wird die Schrift eine Stufe kleiner. Reine Regeln, gleiche in ios/Core/Round1.swift (Hook).
 */
export const HOOK_MAX_LINES = 3;
export const HOOK_SIZE_PT = [17, 15] as const;
export const HOOK_LINE_PT = [22, 20] as const;
/** Mindestweg nach unten, der die Caption zuklappt */
export const CAPTION_SWIPE_PX = 60;

/** Stufe 0 = normal, 1 = eine Stufe kleiner (nur wenn der Hook in Normalgröße mehr als drei Zeilen braucht) */
export const hookStep = (linesAtNormal: number): 0 | 1 => (linesAtNormal > HOOK_MAX_LINES ? 1 : 0);

/** Stelle im Video als Zeit: 1:05, 12:40, 1:02:03 */
export function atTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Zuklappen durch Wischen nach unten: nur wenn der Text oben steht (sonst scrollt er) */
export const closesCaption = (dy: number, scrollTop: number) => dy > CAPTION_SWIPE_PX && scrollTop <= 0;
