import type { AppState } from '../lib/state';
import { actionTap, contradictionTap, countList, dueDate, setTap, tapKey, type TapChoice } from './digest';

/**
 * "This week" (Core Digest, fundament.md Entscheidung 12): Zahlen je Art, Actions mit Done und Drop,
 * Widersprüche mit Option A und B. Nur diese beiden Arten verlangen einen Tap, alles andere läuft von selbst.
 * Ein Tap lässt sich ändern. Der nächste Lauf sammelt den Stand ein.
 */
export function DigestCard({ state, update }: { state: AppState; update: (fn: (s: AppState) => AppState) => void }) {
  const latest = state.digestLatest;
  if (!latest) return null;
  const taps = state.digestTaps;
  const tap = (key: string, choice: TapChoice) => update((s) => ({ ...s, digestTaps: setTap(s.digestTaps, key, choice, Date.now()) }));
  const counts = countList(latest);

  return (
    <section className="wk" data-testid="digest-card" aria-label="This week">
      <div className="wk-head">
        <h2 className="wk-title">This week</h2>
        <span className="wk-week" data-testid="digest-week">
          {latest.week} · {latest.saves} {latest.saves === 1 ? 'save' : 'saves'}
        </span>
      </div>

      {counts.length > 0 && (
        <p className="wk-counts" data-testid="digest-counts">
          {counts.map(({ kind, n }) => (
            <span key={kind} data-kind={kind}>
              {kind} {n}
            </span>
          ))}
        </p>
      )}

      {latest.actions.length > 0 && (
        <div className="wk-sec" data-testid="digest-actions">
          {latest.actions.map((a, i) => {
            const c = actionTap(taps, a.id);
            return (
              <div key={a.id} className="wk-item" data-testid={`digest-action-${i}`}>
                <span className="wk-item-title">{a.title}</span>
                <span className="wk-item-meta">
                  {a.metric} · due {dueDate(a.due)}
                  {a.url && (
                    <>
                      {' · '}
                      <a href={a.url} target="_blank" rel="noopener noreferrer">
                        Source
                      </a>
                    </>
                  )}
                </span>
                <span className="wk-choices">
                  <button className="wk-choice" aria-pressed={c === 'done'} data-testid={`digest-done-${i}`} onClick={() => tap(tapKey.action(a.id), 'done')}>
                    Done
                  </button>
                  <button className="wk-choice" aria-pressed={c === 'drop'} data-testid={`digest-drop-${i}`} onClick={() => tap(tapKey.action(a.id), 'drop')}>
                    Drop
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {latest.contradictions.length > 0 && (
        <div className="wk-sec" data-testid="digest-contradictions">
          {latest.contradictions.map((x, i) => {
            const c = contradictionTap(taps, x.id);
            return (
              <div key={x.id} className="wk-item" data-testid={`digest-contra-${i}`}>
                <span className="wk-item-title">{x.question}</span>
                <span className="wk-choices col">
                  <button className="wk-choice" aria-pressed={c === 'a'} data-testid={`digest-a-${i}`} onClick={() => tap(tapKey.contradiction(x.id), 'a')}>
                    <small>Option A</small>
                    {x.a}
                  </button>
                  <button className="wk-choice" aria-pressed={c === 'b'} data-testid={`digest-b-${i}`} onClick={() => tap(tapKey.contradiction(x.id), 'b')}>
                    <small>Option B</small>
                    {x.b}
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
