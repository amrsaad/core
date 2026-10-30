// Diagnose-Protokoll der App (Max, 30.10.2026): eine Liste für Feed, Player, Hintergrund und Netz,
// in Settings per "Copy diagnostics" kopierbar. Begrenzt auf die letzten 400 Zeilen, nie Schlüssel oder Token.
const MAX = 400;
const lines: string[] = [];
const t0 = Date.now();
const stamp = () => {
  const s = Math.round((Date.now() - t0) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
export const diagLog = {
  push(line: string) {
    lines.push(`${stamp()} ${line}`);
    if (lines.length > MAX) lines.splice(0, lines.length - MAX);
  },
  lines(): readonly string[] {
    return lines;
  },
  /** Zeilen ohne Zeitstempel, für Tests und Zählungen */
  raw(): string[] {
    return lines.map((l) => l.slice(6));
  },
  clear() {
    lines.length = 0;
  },
};
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => diagLog.push('net: online'));
  window.addEventListener('offline', () => diagLog.push('net: offline'));
  document.addEventListener('visibilitychange', () => diagLog.push(`app: ${document.visibilityState}`));
}
