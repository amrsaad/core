import type { AppState } from '../lib/state';
import { AREA_COLOR, AREA_LABEL } from '../lib/labels';
import { weekKey, weekStats } from './review';

export function WeeklyReview({ state, update, now, onDone }: { state: AppState; update: (fn: (s: AppState) => AppState) => void; now: Date; onDone: () => void }) {
  const st = weekStats(state, now);
  const pct = (v: number | null) => (v === null ? 'n/a' : `${v} %`);
  return (
    <div className="pad pad-nav flex h-[100dvh] flex-col gap-5 overflow-y-auto bg-black text-white" data-testid="weekly-review">
      <h1 className="t-headline m-0">Your week</h1>
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
      <dl className="grid grid-cols-3 gap-2 text-center">
        {[
          ['Minutes', String(st.minutes)],
          ['Watched to the end', pct(st.ended)],
          ['Weak or wrong', pct(st.weak)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl bg-[#121212] px-2 py-3">
            <dd className="m-0 text-[22px] font-semibold">{v}</dd>
            <dt className="mt-1 text-[11px] uppercase tracking-[0.08em] text-[#B3B3B3]">{k}</dt>
          </div>
        ))}
      </dl>
      <button
        className="rounded-xl bg-white py-4 text-[17px] font-semibold text-black"
        onClick={() => {
          update((s) => ({ ...s, weekReviewShown: { ...s.weekReviewShown, [weekKey(now)]: true } }));
          onDone();
        }}
      >
        Continue to feed
      </button>
    </div>
  );
}
