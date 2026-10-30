import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { AREA_COLOR } from '../lib/labels';
import { CHIPS, INPUT_BUTTON, INPUT_CHIPS, INPUT_HINT, INPUT_LABEL, INPUT_MAX, TEXT_MAX, type Chip, type InputChip } from './note';
import type { Moment } from './types';

/** Steuerung von außen, nur im Desktop-Modus: Chip nach Nummer wählen, ins Textfeld springen */
export interface NoteCtl {
  chip: (index: number) => void;
  focusText: () => void;
}

/**
 * Rückmeldung in einer Ebene. Oben der Knopf Ask (Claude mit Prompt zu diesem Moment, Taste A). Ein Tipp auf einen Chip speichert sofort (mit dem Text, falls schon einer im Feld steht) und
 * schließt das Blatt. Done speichert nur den Text. Ein Tipp neben das Blatt schließt es ohne Notiz. Kein Send-Knopf.
 * Desktop (keys): die Chips tragen die Nummern 1 bis 6, Enter springt ins Textfeld, Enter im Textfeld speichert (Shift+Enter
 * macht eine neue Zeile).
 * Source und Topic (Entscheidung 20): zwei weitere Chips. Ein Tipp öffnet ein einzeiliges Textfeld (Link oder Name bzw. Thema), Add (oder Enter) speichert
 * die Notiz mit dem Präfix "source:" bzw. "topic:", die Bestätigungszeile steht wie bei den anderen Chips. Back kehrt zu den Chips zurück.
 */
export function NoteSheet({ m, speaker, onChip, onInput, onDone, onAsk, onCancel, confirm, keys, ctl }: { m: Moment; speaker: string; onChip: (chip: Chip, text: string) => void; /** Source oder Topic: Wert aus dem Textfeld */ onInput: (chip: InputChip, value: string) => void; onDone: (text: string) => void; /** Ask: öffnet Claude mit vorausgefülltem Prompt, schließt das Blatt */ onAsk: () => void; onCancel: () => void; /** Bestätigungszeile nach einem Chip (z.B. "Less Barbell Medicine"), solange sie steht sind die Chips gesperrt */ confirm?: string | null; keys?: boolean; ctl?: MutableRefObject<NoteCtl | null> }) {
  const [text, setText] = useState('');
  /** Source oder Topic: Textfeld statt Chips */
  const [mode, setMode] = useState<InputChip | null>(null);
  const [value, setValue] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  const inputField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (mode) inputField.current?.focus();
  }, [mode]);
  const submit = () => {
    if (!mode || confirm || !value.trim()) return;
    onInput(mode, value);
  };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  useEffect(() => {
    if (!ctl) return;
    ctl.current = { chip: (i) => CHIPS[i] && !confirm && onChip(CHIPS[i], text), focusText: () => field.current?.focus() };
    return () => {
      ctl.current = null;
    };
  });
  return (
    <div className="absolute inset-0 z-40 flex items-end bg-black/60" data-testid="note-sheet" onPointerDown={stop} onPointerUp={stop} onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="w-full rounded-t-2xl bg-[#121212] px-4 pt-2 text-white" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + var(--nav-h, 0px) + 16px)' }}>
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-[#3A3D45]" aria-hidden="true" />
        <div className="mb-3 flex items-center gap-2 text-[13px] leading-[18px] text-[#B3B3B3]">
          <span className="h-2 w-2 rounded-full" style={{ background: AREA_COLOR[m.area] }} aria-hidden="true" />
          <span>{speaker}</span>
        </div>
        <div className="note-confirm" data-testid="note-confirm" role="status" aria-live="polite">{confirm ?? ''}</div>
        {mode ? (
          <div className="note-input" data-testid="note-input-panel">
            <div className="note-input-label" data-testid="note-input-label">{INPUT_LABEL[mode]}</div>
            <input
              ref={inputField}
              className="note-text"
              data-testid="note-input"
              type="text"
              enterKeyHint="done"
              autoCapitalize="off"
              autoCorrect="off"
              maxLength={INPUT_MAX}
              placeholder={INPUT_HINT[mode]}
              value={value}
              disabled={!!confirm}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <button type="button" className="note-done" data-testid="note-input-send" disabled={!!confirm || !value.trim()} onClick={submit}>
              {INPUT_BUTTON}
            </button>
            <button type="button" className="note-back" data-testid="note-input-back" disabled={!!confirm} onClick={() => { setMode(null); setValue(''); }}>
              Back
            </button>
          </div>
        ) : (
          <>
          <button type="button" className="note-ask" data-testid="note-ask" disabled={!!confirm} onClick={onAsk}>
            Ask
            {keys && <kbd className="note-key" aria-hidden="true">A</kbd>}
          </button>
          <div className="note-chips" role="group" aria-label="Feedback">
            {CHIPS.map((c, i) => (
              <button key={c} type="button" className="note-chip" data-testid={`note-chip-${c}`} disabled={!!confirm} onClick={() => onChip(c, text)}>
                {c}
                {keys && <kbd className="note-key" aria-hidden="true">{i + 1}</kbd>}
              </button>
            ))}
            {INPUT_CHIPS.map((c) => (
              <button key={c} type="button" className="note-chip" data-testid={`note-chip-${c}`} disabled={!!confirm} onClick={() => { setValue(''); setMode(c); }}>
                {c}
              </button>
            ))}
          </div>
          <textarea
            ref={field}
            className="note-text"
            data-testid="note-text"
            rows={2}
            maxLength={TEXT_MAX}
            placeholder="Note"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (keys && e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onDone(text);
              }
            }}
          />
          <button type="button" className="note-done" data-testid="note-done" onClick={() => onDone(text)}>
            Done
            {keys && <kbd className="note-key" aria-hidden="true">Enter</kbd>}
          </button>
          </>
        )}
      </div>
    </div>
  );
}
