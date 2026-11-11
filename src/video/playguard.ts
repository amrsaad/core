/** Ein Startversuch läuft schon oder das Medium spielt: weitere Anstöße (playVideo, loadedmetadata, canplay) desselben Starts tun nichts (Issue 56, "play#1 bis play#4 binnen 1 s") */
export const PLAY_INFLIGHT_MS = 1500;

export function skipPlay(s: { paused: boolean; inflightAt: number }, now: number, why: string): boolean {
  // Die Wiederholung nach abgelehntem Ton ist ein neuer Versuch
  if (why === 'muted-retry') return false;
  if (!s.paused) return true;
  return s.inflightAt > 0 && now - s.inflightAt < PLAY_INFLIGHT_MS;
}
