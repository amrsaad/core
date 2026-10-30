// Test-Hook: ?now=2026-12-01 verschiebt die App-Zeit (für FSRS-Fälligkeit). Wird in sessionStorage gemerkt.
let offset = 0;
try {
  const p = new URLSearchParams(location.search).get('now') ?? sessionStorage.getItem('core-now');
  if (p) {
    const t = Date.parse(p.length === 10 ? `${p}T12:00:00` : p);
    if (!Number.isNaN(t)) {
      offset = t - Date.now();
      sessionStorage.setItem('core-now', p);
    }
  }
} catch {
  /* kein location in Tests */
}

export const now = (): Date => new Date(Date.now() + offset);
export const isTimeShifted = () => offset !== 0;

/** Lokales Datum YYYY-MM-DD */
export function dayKey(d: Date = now()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
