import { useState } from 'react';
import { AREA_COLOR } from '../lib/labels';
import { CHIPS, toggleChip, type Chip } from './note';
import type { Moment } from './types';

/**
 * Rückmeldung zu einem Moment: Chips (mehrfach) und Freitext. "Send" öffnet die vorbereitete GitHub-Issue-Seite
 * im Browser des Geräts. Die App ruft selbst nichts auf und hält keinen Token.
 */
export function NoteSheet({ m, speaker, initial, onSend, onCancel }: { m: Moment; speaker: string; initial?: { chips: string[]; text: string }; onSend: (chips: Chip[], text: string) => void; onCancel: () => void }) {
  const [chips, setChips] = useState<Chip[]>(() => CHIPS.filter((c) => initial?.chips.includes(c)));
  const [text, setText] = useState(initial?.text ?? '');
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div className="absolute inset-0 z-40 flex items-end bg-black/60" data-testid="note-sheet" onPointerDown={stop} onPointerUp={stop} onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="w-full rounded-t-2xl bg-[#121212] px-4 pt-2 text-white" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}>
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-[#3A3D45]" aria-hidden="true" />
        <div className="mb-3 flex items-center gap-2 text-[13px] leading-[18px] text-[#B3B3B3]">
          <span className="h-2 w-2 rounded-full" style={{ background: AREA_COLOR[m.area] }} aria-hidden="true" />
          <span>Note · {speaker}</span>
        </div>
        <div className="note-chips" role="group" aria-label="Chips">
          {CHIPS.map((c) => (
            <button key={c} type="button" className="note-chip" data-testid={`note-chip-${c}`} aria-pressed={chips.includes(c)} onClick={() => setChips((x) => toggleChip(x, c))}>
              {c}
            </button>
          ))}
        </div>
        <textarea className="note-text" data-testid="note-text" rows={3} maxLength={1500} placeholder="What should change?" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="note-actions">
          <button type="button" className="note-cancel" data-testid="note-cancel" onClick={onCancel}>Cancel</button>
          <button type="button" className="note-send" data-testid="note-send" onClick={() => onSend(chips, text)}>Send</button>
        </div>
      </div>
    </div>
  );
}
