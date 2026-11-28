import { useLayoutEffect, useRef } from 'react';
import { AREA_DK, AREA_LABEL } from './area';
import type { QueueRow } from './model';
import { arAttrs, cleanText } from '../textfit';

/**
 * Linke Spalte der Mac-Ansicht (Runde 44): "Up next", der laufende Moment zuerst und hervorgehoben, dahinter die nächsten der echten Warteschlange.
 * Ein Klick springt über goTo des Feeds. Unten der Tageszähler. Was nicht ganz in die Spalte passt, wird ausgeblendet statt angeschnitten.
 */
export function DeskQueue({ rows, queued, nowLabel, todayText, onGo }: { rows: QueueRow[]; queued: number; nowLabel: string; todayText: string; onGo: (index: number) => void }) {
  const list = useRef<HTMLOListElement>(null);
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const fit = () => {
      const items = [...el.children] as HTMLElement[];
      for (const li of items) li.hidden = false;
      const limit = el.clientHeight;
      let cut = false;
      for (const li of items) {
        if (cut || li.offsetTop + li.offsetHeight > limit + 1) {
          li.hidden = true;
          cut = true;
        }
      }
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  });
  return (
    <div className="dq-in" data-testid="desk-queue">
      <div className="dq-head">
        <h2>Up next</h2>
        <span data-testid="desk-queue-count">{queued} queued</span>
      </div>
      <ol className="dq-list" ref={list}>
        {rows.map((r) => (
          <li key={`${r.index}:${r.id}`}>
            <button type="button" className="dq-item" data-testid="desk-queue-item" data-index={r.index} data-current={r.current ? '' : undefined} aria-current={r.current ? 'true' : undefined} style={{ ['--ad' as string]: AREA_DK[r.area] }} onClick={() => onGo(r.index)}>
              <span className="dq-tag">
                <i aria-hidden="true" />
                {AREA_LABEL[r.area]}
                {r.current ? ` · ${nowLabel}` : ''}
              </span>
              <span className="dq-hook" dir="auto" {...arAttrs(r.hook)}>
                {cleanText(r.hook)}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className="dq-today" data-testid="desk-today">
        {todayText}
      </div>
    </div>
  );
}
