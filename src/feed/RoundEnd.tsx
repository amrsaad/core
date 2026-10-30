import { useState } from 'react';
import type { Card } from '../types';
import type { AppState } from '../lib/state';
import { recallFor } from './recall';
import { stats } from './stats';

interface Props {
  roundNo: number;
  limitReached: boolean;
  quiz: Card[];
  state: AppState;
  now: Date;
  onQuiz: (id: string, hit: boolean) => void;
  onMore: () => void;
  onDone: () => void;
}

function Quiz({ card, onAnswer }: { card: Card; onAnswer: (hit: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [answered, setAnswered] = useState<boolean | null>(null);
  const { q, a } = recallFor(card);
  return (
    <div className="rounded-xl bg-surface p-4">
      <p className="m-0 text-[17px] leading-[25px]">{q}</p>
      {!open ? (
        <button onClick={() => setOpen(true)} className="t-meta mt-3 text-muted">
          Antwort zeigen
        </button>
      ) : (
        <>
          <p className="m-0 mt-2 text-[17px] font-semibold leading-[25px]">{a}</p>
          {answered === null ? (
            <div className="mt-3 flex gap-2">
              {[
                ['Gewusst', true],
                ['Nicht gewusst', false],
              ].map(([label, hit]) => (
                <button
                  key={String(label)}
                  onClick={() => {
                    setAnswered(hit as boolean);
                    onAnswer(hit as boolean);
                  }}
                  className="rounded-lg border border-[var(--line)] px-3 py-2 text-[15px]"
                >
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <p className="t-meta mt-3 text-muted">{answered ? 'Gewusst' : 'Nicht gewusst'}</p>
          )}
        </>
      )}
    </div>
  );
}

export function RoundEnd({ roundNo, limitReached, quiz, state, now, onQuiz, onMore, onDone }: Props) {
  const s = stats(state, now);
  return (
    <div className="pad pad-nav flex h-full flex-col justify-center gap-5 overflow-y-auto">
      <h2 className="t-headline m-0">Runde {roundNo} von heute fertig</h2>
      <div className="flex flex-col gap-3">
        <div className="t-meta text-muted">Drei Fragen aus dieser Runde</div>
        {quiz.map((c) => (
          <Quiz key={c.id} card={c} onAnswer={(hit) => onQuiz(c.id, hit)} />
        ))}
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center">
        {[
          ['Behalten', String(s.retained)],
          ['Trefferquote 7 T.', s.hitRate === null ? 'k. A.' : `${s.hitRate} %`],
          ['Tage in Folge', String(s.streak)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl bg-surface px-2 py-3">
            <dd className="m-0 text-[22px] font-semibold">{v}</dd>
            <dt className="t-meta mt-1 text-muted">{k}</dt>
          </div>
        ))}
      </dl>
      <div className="flex gap-3">
        {!limitReached && (
          <button onClick={onMore} className="flex-1 rounded-xl bg-[var(--fg)] py-4 text-[17px] font-semibold text-[var(--bg)]">
            Noch eine Runde
          </button>
        )}
        <button onClick={onDone} className="flex-1 rounded-xl border border-[var(--line)] py-4 text-[17px] font-semibold">
          Fertig
        </button>
      </div>
      {limitReached && <p className="t-meta m-0 text-muted">Tageslimit erreicht</p>}
    </div>
  );
}
