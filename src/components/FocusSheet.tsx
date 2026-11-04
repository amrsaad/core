import { useState } from 'react';
import { AREA_ORDER, clearFocus, focusActive, focusUntil, LANG_LABEL, LANGS, writeFocus, type Focus, type FocusDur, type Lang } from '../moments/focus';
import { AREA_LABEL } from '../lib/labels';
import type { Area } from '../types';

const DURS: Array<[FocusDur, string]> = [['session', 'This session'], ['hour', '1 hour'], ['today', 'Today']];

/**
 * Fokus-Blatt (Entscheidung 39, Ergänzung 03.11.): öffnet von unten nach langem Druck auf einen Reiternamen.
 * Bereiche, Sprachen, Dauer als Chips, ein Knopf "Start focus". Der Fokus gilt nur auf diesem Gerät.
 * Logik liegt in moments/focus.ts, hier nur die Auswahl.
 */
export function FocusSheet({ current, now, onClose }: { current: Focus | null; now: number; onClose: () => void }) {
  const active = focusActive(current, now) ? current : null;
  const [areas, setAreas] = useState<Area[]>(active?.areas ?? []);
  const [langs, setLangs] = useState<Lang[]>(active?.langs ?? []);
  const [dur, setDur] = useState<FocusDur>(active?.dur ?? 'session');
  const toggle = <T,>(list: T[], v: T, set: (x: T[]) => void) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const start = () => {
    writeFocus({ areas, langs, until: focusUntil(dur, now), dur });
    onClose();
  };
  const none = !areas.length && !langs.length;
  return (
    <div className="sheet-backdrop" data-testid="focus-sheet" onPointerDown={stop} onPointerUp={stop} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-label="Focus">
        <div className="sheet-grip" aria-hidden="true" />
        <h2 className="sheet-title">Focus <small>Only on this device</small></h2>
        <div className="sheet-label">Areas</div>
        <div className="chips" role="group" aria-label="Areas">
          {AREA_ORDER.map((a, i) => (
            <button key={a} type="button" className="chip" style={{ ['--i' as string]: i }} aria-pressed={areas.includes(a)} onClick={() => toggle(areas, a, setAreas)}>{AREA_LABEL[a]}</button>
          ))}
        </div>
        <div className="sheet-label">Languages</div>
        <div className="chips" role="group" aria-label="Languages">
          {LANGS.map((l, i) => (
            <button key={l} type="button" className="chip" style={{ ['--i' as string]: i + 3 }} aria-pressed={langs.includes(l)} onClick={() => toggle(langs, l, setLangs)}>{LANG_LABEL[l]}</button>
          ))}
        </div>
        <div className="sheet-label">For how long</div>
        <div className="chips" role="group" aria-label="Duration">
          {DURS.map(([d, label], i) => (
            <button key={d} type="button" className="chip" style={{ ['--i' as string]: i + 6 }} aria-pressed={dur === d} onClick={() => setDur(d)}>{label}</button>
          ))}
        </div>
        <button type="button" className="btn-primary" data-testid="focus-start" disabled={none} onClick={start}>Start focus</button>
        {active && (
          <button type="button" className="note-back" data-testid="focus-clear" onClick={() => { clearFocus(); onClose(); }}>End focus</button>
        )}
      </div>
    </div>
  );
}
