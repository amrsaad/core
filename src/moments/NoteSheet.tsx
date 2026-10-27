import { useRef, useState } from 'react';
import { AREA_COLOR } from '../lib/labels';
import { CHIPS, TEXT_MAX, type Chip } from './note';
import type { Moment } from './types';

/**
 * Rückmeldung in einer Ebene. Ein Tipp auf einen Chip speichert sofort (mit dem Text, falls schon einer im Feld steht) und
 * schließt das Blatt. Done speichert nur den Text. Ein Tipp neben das Blatt schließt es ohne Notiz. Kein Send-Knopf.
 */
export function NoteSheet({ m, speaker, onChip, onDone, onCancel }: { m: Moment; speaker: string; onChip: (chip: Chip, text: string) => void; onDone: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div className="absolute inset-0 z-40 flex items-end bg-black/60" data-testid="note-sheet" onPointerDown={stop} onPointerUp={stop} onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="w-full rounded-t-2xl bg-[#121212] px-4 pt-2 text-white" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}>
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-[#3A3D45]" aria-hidden="true" />
        <div className="mb-3 flex items-center gap-2 text-[13px] leading-[18px] text-[#B3B3B3]">
          <span className="h-2 w-2 rounded-full" style={{ background: AREA_COLOR[m.area] }} aria-hidden="true" />
          <span>{speaker}</span>
        </div>
        <div className="note-chips" role="group" aria-label="Feedback">
          {CHIPS.map((c) => (
            <button key={c} type="button" className="note-chip" data-testid={`note-chip-${c}`} onClick={() => onChip(c, text)}>
              {c}
            </button>
          ))}
        </div>
        <textarea ref={field} className="note-text" data-testid="note-text" rows={2} maxLength={TEXT_MAX} placeholder="Note" value={text} onChange={(e) => setText(e.target.value)} />
        <button type="button" className="note-done" data-testid="note-done" onClick={() => onDone(text)}>
          Done
        </button>
      </div>
    </div>
  );
}
