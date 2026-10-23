import { useState } from 'react';
import { GRADES } from '../lib/fsrs';
import type { SavedItem } from '../lib/state';
import type { Grade } from 'ts-fsrs';
import { MetaLine, SourceLine } from './CardView';
import { recallFor } from './recall';

export function RecallView({ item, onGrade }: { item: SavedItem; onGrade: (r: Grade) => void }) {
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState(false);
  const { q, a } = recallFor(item.card);
  return (
    <div className="pad pad-nav flex h-full flex-col justify-center gap-6">
      <MetaLine card={item.card} extra="Abruf" />
      <h2 className="t-headline m-0">{q}</h2>
      {!shown ? (
        <button onClick={() => setShown(true)} className="t-body rounded-xl bg-surface px-4 py-4 text-left text-muted">
          Antwort zeigen
        </button>
      ) : (
        <>
          <div className="rounded-xl bg-surface p-4">
            <div className="t-meta mb-1 text-muted">Antwort</div>
            <p className="t-body m-0">{a}</p>
          </div>
          {done ? (
            <p className="t-meta text-muted">Bewertet. Weiter nach oben wischen.</p>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {GRADES.map((g) => (
                <button
                  key={g.label}
                  onClick={() => {
                    setDone(true);
                    onGrade(g.rating);
                  }}
                  className="rounded-xl border border-[var(--line)] bg-surface px-1 py-3 text-[15px]"
                >
                  {g.label}
                </button>
              ))}
            </div>
          )}
          <SourceLine card={item.card} />
        </>
      )}
    </div>
  );
}
