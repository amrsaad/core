/** Ein Slot lädt einen Moment nicht noch einmal, wenn Moment-ID und Startzeit gleich sind (Issue 56): die Vorladung bleibt bei jedem erneuten Plan erhalten. */
export interface SlotLoad {
  mid: string;
  loadStart: number;
}

export function needsLoad(slot: SlotLoad, m: { id: string; start: number }): boolean {
  return slot.mid !== m.id || slot.loadStart !== m.start;
}

/**
 * Issue 54 (Brief 12, Punkt 3): Vorlade-Gate beim Kaltstart. Ein YouTube-Nachbar wartet nur dann, bis der aktuelle YouTube-Moment spielt, wenn er
 * wirklich laden würde. Auf iOS wird er nur per cue vorbereitet (Metadaten, Vorschaubild), das kostet kaum Leitung: er läuft sofort los, damit beim
 * Wisch der Player bereit steht (state 5) statt -1.
 */
export function holdsNeighbor(cur: { yt: boolean }, next: { yt: boolean }, cueOnly: boolean): boolean {
  return cur.yt && next.yt && !cueOnly;
}

/**
 * Issue 59: ein abgelehntes play() mit AbortError (load, src-Wechsel oder pause() auf demselben Element, solange das play() noch aussteht).
 * Will der Feed den Moment weiter spielen (wantPlay), steht das Element still, ist es noch der aktuelle Stand und gab es noch keinen Wiederholungsstart
 * seit dem letzten Laden, kommt genau einer. Ein Abbruch durch unser eigenes Anhalten (wantPlay false) bleibt ein Abbruch.
 */
export function abortAction(s: { wantPlay: boolean; current: boolean; paused: boolean; retries: number }): 'retry' | 'ignore' {
  return s.wantPlay && s.current && s.paused && s.retries < 1 ? 'retry' : 'ignore';
}

/** Ein Medien-Element für die Zeile "media: ..." der Diag (Issue 59): Tag, Besitzer (slotN, deck, pool, clip, unknown), Quelle */
export interface MediaItem {
  tag: string;
  owner: string;
  src: string;
}

/** Nur der Host der Quelle, nie die ganze URL (Datenschutz, Länge): data und blob als Art, relative Pfade als "relative" */
export function hostOfSrc(src: string): string {
  if (src.startsWith('data:')) return 'data';
  if (src.startsWith('blob:')) return 'blob';
  try {
    return new URL(src).hostname || 'none';
  } catch {
    return 'relative';
  }
}

/** Zeile für die Diag: Anzahl, Grenze und je Element "tag besitzer host", nach Besitzer sortiert */
export function describeMedia(items: readonly MediaItem[], limit: number): string {
  const rows = items
    .map((i) => `${i.tag.toLowerCase()} ${i.owner} ${hostOfSrc(i.src)}`)
    .sort();
  return `media: ${items.length} elements with src (limit ${limit})${rows.length ? `: ${rows.join(', ')}` : ''}`;
}
