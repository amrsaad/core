import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { AREA_COLOR, AREA_LABEL } from '../lib/labels';
import { shuffleOrder } from './recall';
import { isArabic, thumbOf, type Moment } from './types';

/** Steuerung von außen, nur im Desktop-Modus: Antwort nach angezeigter Stelle (0 bis 2) wählen */
export interface RecallCtl {
  pick: (shown: number) => void;
}

/**
 * Abrufkarte: Cover, Sprecher und Bereich, darunter die Frage, darunter die drei Antworten in zufälliger Reihenfolge.
 * Erst nach dem Tipp: richtige Antwort grün, falsch gewählte rot, dann recall.why und "Next".
 * Die Wertung zählt beim Tipp. Wischen nach oben schließt, vor der Wahl ohne Wertung. Arabisch läuft rechtsläufig.
 */
export function RecallCard({ m, review, rng, onAnswer, onClose, keys, ctl }: { m: Moment; review: boolean; rng: () => number; onAnswer: (got: boolean) => void; onClose: () => void; keys?: boolean; ctl?: MutableRefObject<RecallCtl | null> }) {
  const r = m.recall!;
  const order = useMemo(() => shuffleOrder(r.options.length, rng), [m.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [chosen, setChosen] = useState<number | null>(null);
  const y = useRef(0);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const speaker = m.channel.replace(/^(.*?)\s*\((.+)\)$/, '$1 · $2');
  const ar = isArabic(r.question);
  const dir = ar ? 'rtl' : 'ltr';
  const pick = (i: number) => {
    if (chosen !== null) return;
    setChosen(i);
    onAnswer(i === r.correct);
  };
  useEffect(() => {
    if (!ctl) return;
    ctl.current = { pick: (shown) => order[shown] !== undefined && pick(order[shown]) };
    return () => {
      ctl.current = null;
    };
  });
  return (
    <div
      className="recall no-callout"
      data-testid="recall-card"
      dir={dir}
      lang={ar ? 'ar' : 'en'}
      style={{ ['--area' as string]: AREA_COLOR[m.area] }}
      onPointerDown={stop}
      onPointerUp={stop}
      onTouchStart={(e) => (y.current = e.touches[0].clientY)}
      onTouchEnd={(e) => {
        if (e.changedTouches[0].clientY - y.current < -80) onClose();
      }}
    >
      <div className="recall-source">
        <img src={thumbOf(m)} alt="" draggable={false} />
        <div>
          <div className="recall-area" style={{ color: AREA_COLOR[m.area] }}>{AREA_LABEL[m.area]}</div>
          <div className="recall-speaker">{speaker}{review ? ' · again' : ''}</div>
        </div>
      </div>
      <h2 className="recall-q" data-testid="recall-question">{r.question}</h2>
      <div className="recall-options">
        {order.map((i, shown) => {
          const state = chosen === null ? '' : i === r.correct ? 'right' : i === chosen ? 'wrong' : 'rest';
          return (
            <button key={i} className={`recall-option ${state}`} data-testid="recall-option" data-correct={i === r.correct ? '1' : '0'} data-state={state} disabled={chosen !== null && state === 'rest' ? true : undefined} aria-pressed={chosen === i} onClick={() => pick(i)}>
              {r.options[i]}
              {keys && <kbd className="recall-key" aria-hidden="true">{shown + 1}</kbd>}
            </button>
          );
        })}
      </div>
      {chosen !== null && (
        <>
          <p className="recall-why" data-testid="recall-why">{r.why}</p>
          <button className="recall-primary" data-testid="recall-next" onClick={onClose}>
            Next
            {keys && <kbd className="recall-key" aria-hidden="true">Enter</kbd>}
          </button>
        </>
      )}
    </div>
  );
}
