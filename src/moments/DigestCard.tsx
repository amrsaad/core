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

  const choice = (selected: boolean) =>
    `min-h-[44px] flex-1 rounded-xl border px-3 py-2 text-[16px] leading-[22px] ${selected ? 'border-[var(--fg)] bg-[var(--fg)] font-semibold text-[var(--bg)]' : 'border-[var(--line)]'}`;

  return (
    <section className="flex flex-col gap-3 rounded-xl bg-surface p-4" data-testid="digest-card" aria-label="This week">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="t-headline m-0 text-[20px]">This week</h2>
        <span className="t-meta text-muted" data-testid="digest-week">
          {latest.week} · {latest.saves} {latest.saves === 1 ? 'save' : 'saves'}
        </span>
      </div>

      {counts.length > 0 && (
        <p className="t-meta m-0 flex flex-wrap gap-x-3 gap-y-1 text-muted" data-testid="digest-counts">
          {counts.map(({ kind, n }) => (
            <span key={kind} data-kind={kind}>
              {kind} {n}
            </span>
          ))}
        </p>
      )}

      {latest.actions.length > 0 && (
        <div className="flex flex-col gap-3" data-testid="digest-actions">
          {latest.actions.map((a, i) => {
            const c = actionTap(taps, a.id);
            return (
              <div key={a.id} className="flex flex-col gap-2 border-t border-[var(--line)] pt-3" data-testid={`digest-action-${i}`}>
                <span className="text-[16px] font-semibold leading-[22px]">{a.title}</span>
                <span className="text-[14px] leading-[20px] text-muted">
                  {a.metric} · due {dueDate(a.due)}
                  {a.url && (
                    <>
                      {' · '}
                      <a href={a.url} target="_blank" rel="noopener noreferrer" className="underline">
                        Source
                      </a>
                    </>
                  )}
                </span>
                <span className="flex gap-2">
                  <button className={choice(c === 'done')} aria-pressed={c === 'done'} data-testid={`digest-done-${i}`} onClick={() => tap(tapKey.action(a.id), 'done')}>
                    Done
                  </button>
                  <button className={choice(c === 'drop')} aria-pressed={c === 'drop'} data-testid={`digest-drop-${i}`} onClick={() => tap(tapKey.action(a.id), 'drop')}>
                    Drop
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {latest.contradictions.length > 0 && (
        <div className="flex flex-col gap-3" data-testid="digest-contradictions">
          {latest.contradictions.map((x, i) => {
            const c = contradictionTap(taps, x.id);
            return (
              <div key={x.id} className="flex flex-col gap-2 border-t border-[var(--line)] pt-3" data-testid={`digest-contra-${i}`}>
                <span className="text-[16px] font-semibold leading-[22px]">{x.question}</span>
                <span className="flex flex-col gap-2">
                  <button className={choice(c === 'a')} aria-pressed={c === 'a'} data-testid={`digest-a-${i}`} onClick={() => tap(tapKey.contradiction(x.id), 'a')}>
                    <span className="t-meta block opacity-70">Option A</span>
                    {x.a}
                  </button>
                  <button className={choice(c === 'b')} aria-pressed={c === 'b'} data-testid={`digest-b-${i}`} onClick={() => tap(tapKey.contradiction(x.id), 'b')}>
                    <span className="t-meta block opacity-70">Option B</span>
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
