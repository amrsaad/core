import { useState } from 'react';
import type { AppState } from '../lib/state';
import { AREA_COLOR, AREA_LABEL } from '../lib/labels';
import { planComplete, prevWeekKey, weekKey, weekLine, weekStats, weekTask } from './review';

/**
 * Wochenrückblick (Punkt 7, R13, R14, R16). Feste Reihenfolge: Plan der Vorwoche, gespeicherte Momente abhaken,
 * Zahlen zur Aufgabe, genau ein Plan für die neue Woche. Kein Lob, kein Vergleich.
 */
export function WeeklyReview({ state, update, now, onDone }: { state: AppState; update: (fn: (s: AppState) => AppState) => void; now: Date; onDone: () => void }) {
  const st = weekStats(state, now);
  const task = weekTask(state, now);
  const prevKey = prevWeekKey(now);
  const prev = state.plans?.[prevKey];
  const key = weekKey(now);
  const [when, setWhen] = useState(state.plans?.[key]?.when ?? '');
  const [will, setWill] = useState(state.plans?.[key]?.will ?? '');
  const ok = planComplete(when, will);

  const close = (save: boolean) => {
    update((s) => ({
      ...s,
      weekReviewShown: { ...s.weekReviewShown, [key]: true },
      plans: save ? { ...(s.plans ?? {}), [key]: { when: when.trim(), will: will.trim() } } : s.plans,
    }));
    onDone();
  };
  const answerPrev = (happened: boolean) => update((s) => ({ ...s, plans: { ...(s.plans ?? {}), [prevKey]: { ...s.plans![prevKey], happened } } }));

  const card = 'rounded-xl bg-[#121212] p-4';
  const field = 'w-full rounded-xl border border-[#333] bg-[#111] px-3 py-3 text-[17px] text-white';
  return (
    <div className="pad pad-nav flex h-[100dvh] flex-col gap-5 overflow-y-auto bg-black text-white" data-testid="weekly-review">
      <h1 className="t-headline m-0">Your week</h1>

      {prev && (
        <section className={card} data-testid="prev-plan">
          <div className="text-[12px] uppercase tracking-[0.08em] text-[#8a8a8a]">Last week's plan</div>
          <p className="m-0 mt-2 text-[17px] leading-[24px]">
            When {prev.when}, I will {prev.will}.
          </p>
          <div className="mt-3 text-[15px] text-[#B3B3B3]">Did it happen?</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {([true, false] as const).map((v) => (
              <button
                key={String(v)}
                aria-pressed={prev.happened === v}
                onClick={() => answerPrev(v)}
                className={`min-h-[48px] rounded-xl border text-[17px] font-semibold ${prev.happened === v ? 'border-white bg-white text-black' : 'border-[#3a3d45]'}`}
              >
                {v ? 'Yes' : 'No'}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <p className="m-0 text-[15px] leading-[22px] text-[#B3B3B3]">Saved moments. Check off what you applied.</p>
        {!st.saved.length && <p className="m-0 text-[17px] text-[#B3B3B3]">Nothing saved this week.</p>}
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {st.saved.map(({ moment: m, done }) => (
            <li key={m.id}>
              <label className="flex items-start gap-3 rounded-xl bg-[#121212] p-4">
                <input
                  type="checkbox"
                  className="mt-1 h-5 w-5"
                  checked={!!done}
                  onChange={(e) => update((s) => ({ ...s, savedMoments: { ...s.savedMoments, [m.id]: { ...s.savedMoments[m.id], done: e.target.checked } } }))}
                />
                <span className="flex flex-col gap-1">
                  <span className="text-[12px] uppercase tracking-[0.08em]" style={{ color: AREA_COLOR[m.area] }}>
                    {AREA_LABEL[m.area]} <span className="text-[#B3B3B3]">· {m.channel}</span>
                  </span>
                  <span className="text-[17px] leading-[24px]">{m.hook}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <p className="m-0 text-[17px]" data-testid="week-line">
        This week: {weekLine(task)}
      </p>

      <section className={`${card} flex flex-col gap-3`} data-testid="new-plan">
        <div className="text-[12px] uppercase tracking-[0.08em] text-[#8a8a8a]">One plan for next week</div>
        <label className="flex flex-col gap-1">
          <span className="text-[15px] text-[#B3B3B3]">When …</span>
          <input className={field} data-testid="plan-when" value={when} onChange={(e) => setWhen(e.target.value)} placeholder="I finish the OCT clinic on Tuesday" autoCapitalize="off" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[15px] text-[#B3B3B3]">I will …</span>
          <input className={field} data-testid="plan-will" value={will} onChange={(e) => setWill(e.target.value)} placeholder="explain one saved moment to a colleague" autoCapitalize="off" />
        </label>
      </section>

      <button className="rounded-xl bg-white py-4 text-[17px] font-semibold text-black disabled:opacity-40" disabled={!ok} onClick={() => close(true)}>
        Save plan and continue
      </button>
      <button className="pb-2 text-[15px] text-[#B3B3B3]" onClick={() => close(false)}>
        Skip this week
      </button>
    </div>
  );
}
