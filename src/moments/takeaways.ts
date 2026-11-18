// Zählhelfer für die Startzeile "takeaways: N in pool, M recall due" (Runde 24): wie viele Kernaussagen im Pool stehen und wie viele ihrer Abrufkarten fällig sind.
import type { RecallState } from './recall';
import type { Moment } from './types';

/** Präfix der IDs von Takeaway-Momenten */
export const TAKEAWAY_ID = 'txt-takeaway-';

/** N: Momente mit kind takeaway im Pool. M: Abrufkarten zu Takeaway-IDs, die jetzt fällig sind (due höchstens jetzt, abgeschlossene mit due null zählen nicht). */
export function takeawayCounts(moments: readonly Pick<Moment, 'kind'>[], recall: RecallState | undefined, now: number): { pool: number; due: number } {
  const pool = moments.filter((m) => m.kind === 'takeaway').length;
  const due = Object.values(recall ?? {}).filter((x) => x.id.startsWith(TAKEAWAY_ID) && x.due !== null && x.due <= now).length;
  return { pool, due };
}

export const takeawayLine = (c: { pool: number; due: number }): string => `takeaways: ${c.pool} in pool, ${c.due} recall due`;
