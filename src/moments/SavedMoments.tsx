import { useState } from 'react';
import type { AppState } from '../lib/state';
import { AREA_COLOR, AREA_LABEL } from '../lib/labels';
import { MomentModal } from './MomentModal';
import { fullVideoUrl, thumbOf, type Moment } from './types';

export function SavedMoments({ state, update }: { state: AppState; update: (fn: (s: AppState) => AppState) => void }) {
  const [playing, setPlaying] = useState<Moment | null>(null);
  const items = Object.values(state.savedMoments).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  return (
    <div className="pad pad-nav flex h-[100dvh] flex-col gap-4 overflow-y-auto">
      <h1 className="t-headline m-0">Saved</h1>
      {!items.length && <p className="t-body text-muted">Double tap a moment to save it here.</p>}
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {items.map(({ moment: m, done }) => (
          <li key={m.id} className="flex gap-3 rounded-xl bg-surface p-3">
            <button className="relative h-24 w-16 shrink-0 overflow-hidden rounded-lg bg-black" onClick={() => setPlaying(m)} aria-label={`Watch ${m.hook}`}>
              <img src={thumbOf(m)} alt="" className="h-full w-full object-cover" loading="lazy" />
            </button>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="t-meta" style={{ color: AREA_COLOR[m.area] }}>
                {AREA_LABEL[m.area]} <span className="text-muted">· {m.channel}{done ? ' · applied' : ''}</span>
              </span>
              <span className="text-[16px] font-semibold leading-[22px]">{m.hook}</span>
              {m.forYou && <span className="text-[14px] leading-[20px] text-muted">{m.forYou}</span>}
              <span className="mt-1 flex gap-4">
                {fullVideoUrl(m) && <a className="t-meta text-muted" href={fullVideoUrl(m)} target="_blank" rel="noopener noreferrer">{m.form === 'text' ? 'Source' : m.audio ? 'Full episode' : 'Full video'}</a>}
                <button
                  className="t-meta text-muted"
                  onClick={() => update((s) => { const x = { ...s.savedMoments }; delete x[m.id]; return { ...s, savedMoments: x }; })}
                >
                  Remove
                </button>
              </span>
            </div>
          </li>
        ))}
      </ul>
      {playing && <MomentModal moment={playing} onClose={() => setPlaying(null)} />}
    </div>
  );
}
