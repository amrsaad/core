/** Ein Slot lädt einen Moment nicht noch einmal, wenn Moment-ID und Startzeit gleich sind (Issue 56): die Vorladung bleibt bei jedem erneuten Plan erhalten. */
export interface SlotLoad {
  mid: string;
  loadStart: number;
}

export function needsLoad(slot: SlotLoad, m: { id: string; start: number }): boolean {
  return slot.mid !== m.id || slot.loadStart !== m.start;
}
