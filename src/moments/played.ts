// Entscheidung 45: Übersprungen ist nicht gesehen. Ein Moment zählt erst als gesehen, wenn er mindestens PLAYED_MIN_MS wirklich gespielt hat
// (Zustand PLAYING des Players, nicht die Zeit seit dem Ankommen). Gilt für Video und Audio. Reine Klasse, die Uhr kommt von außen.

/** So lange muss ein Moment gespielt haben, damit er als gesehen zählt (ms) */
export const PLAYED_MIN_MS = 1000;

interface Run {
  acc: number;
  since: number | null;
}

export class PlayTracker {
  private runs = new Map<string, Run>();
  constructor(private now: () => number = () => performance.now()) {}

  /** Der Player des aktuellen Moments meldet PLAYING (true) oder einen anderen Zustand (false) */
  set(id: string, playing: boolean) {
    const r = this.runs.get(id) ?? { acc: 0, since: null };
    const t = this.now();
    if (playing && r.since === null) r.since = t;
    else if (!playing && r.since !== null) {
      r.acc += t - r.since;
      r.since = null;
    }
    this.runs.set(id, r);
  }

  /** Bisher gespielte Zeit des Moments in diesem Lauf (ms) */
  ms(id: string): number {
    const r = this.runs.get(id);
    return r ? r.acc + (r.since !== null ? this.now() - r.since : 0) : 0;
  }

  /** Mindestens PLAYED_MIN_MS gespielt: darf als gesehen zählen */
  enough(id: string): boolean {
    return this.ms(id) >= PLAYED_MIN_MS;
  }

  /** Hat der Moment überhaupt gespielt (für Wertungen wie "schnell weggewischt") */
  any(id: string): boolean {
    return this.ms(id) > 0;
  }
}
