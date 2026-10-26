import { useRef, useState } from 'react';
import { AREA_COLOR, AREA_LABEL } from '../lib/labels';
import { thumbOf, type Moment } from './types';

/**
 * Abrufkarte (Punkt 5): erst ein Satz aus dem Gedächtnis, dann die Musterantwort (der Hook), dann Selbstbewertung.
 * Der Hook ist die Antwort und erscheint deshalb erst nach dem Versuch. Wischen nach oben überspringt ohne Wertung.
 */
export function RecallCard({ m, review, onDone }: { m: Moment; review: boolean; onDone: (got: boolean | null) => void }) {
  const [stage, setStage] = useState<'ask' | 'show'>('ask');
  const [text, setText] = useState('');
  const y = useRef(0);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const speaker = m.channel.replace(/^(.*?)\s*\((.+)\)$/, '$1 · $2');
  return (
    <div
      className="recall no-callout"
      data-testid="recall-card"
      style={{ ['--area' as string]: AREA_COLOR[m.area] }}
      onPointerDown={stop}
      onPointerUp={stop}
      onTouchStart={(e) => (y.current = e.touches[0].clientY)}
      onTouchEnd={(e) => {
        const dy = e.changedTouches[0].clientY - y.current;
        if (dy < -80 && (e.target as HTMLElement).tagName !== 'TEXTAREA') onDone(null);
      }}
    >
      <div className="recall-label">{review ? 'RECALL · ONE WEEK LATER' : 'RECALL'}</div>
      <div className="recall-source">
        <img src={thumbOf(m)} alt="" draggable={false} />
        <div>
          <div className="recall-area" style={{ color: AREA_COLOR[m.area] }}>{AREA_LABEL[m.area]}</div>
          <div className="recall-speaker">{speaker}</div>
        </div>
      </div>
      <h2 className="recall-q">What was the point?</h2>
      {stage === 'ask' && (
        <>
          <textarea
            className="recall-input"
            data-testid="recall-input"
            rows={3}
            maxLength={240}
            placeholder="One sentence, from memory"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button className="recall-primary" onClick={() => setStage('show')}>
            Show answer
          </button>
          <button className="recall-skip" onClick={() => onDone(null)}>
            Skip
          </button>
        </>
      )}
      {stage === 'show' && (
        <>
          {text.trim() && (
            <div className="recall-mine">
              <span>You</span>
              <p>{text.trim()}</p>
            </div>
          )}
          <div className="recall-answer" data-testid="recall-answer">
            <span>The point</span>
            <p>{m.hook}</p>
          </div>
          <div className="recall-rate">
            <button onClick={() => onDone(true)}>Got it</button>
            <button onClick={() => onDone(false)}>Missed</button>
          </div>
        </>
      )}
    </div>
  );
}
