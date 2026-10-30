import { useState } from 'react';
import type { AppState } from '../lib/state';
import { AREA_COLOR, AREA_LABEL } from '../lib/labels';
import { SavedCards } from './Saved';
import { VideoModal } from '../video/VideoModal';
import type { Video } from '../videoTypes';

export function Saved({ state, update }: { state: AppState; update: (fn: (s: AppState) => AppState) => void }) {
  const [tab, setTab] = useState<'videos' | 'cards'>(Object.keys(state.savedVideos).length || !Object.keys(state.saved).length ? 'videos' : 'cards');
  const [playing, setPlaying] = useState<Video | null>(null);
  const videos = Object.values(state.savedVideos).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  const seg = (on: boolean) => `flex-1 rounded-lg py-2 text-[15px] ${on ? 'bg-[var(--fg)] text-[var(--bg)]' : 'text-muted'}`;
  return (
    <div className="pad pad-nav flex h-[100dvh] flex-col gap-4 overflow-y-auto">
      <h1 className="t-headline m-0">Gespeichert</h1>
      <div className="flex gap-1 rounded-xl border border-[var(--line)] p-1">
        <button className={seg(tab === 'videos')} onClick={() => setTab('videos')}>Videos {videos.length}</button>
        <button className={seg(tab === 'cards')} onClick={() => setTab('cards')}>Karten {Object.keys(state.saved).length}</button>
      </div>
      {tab === 'cards' ? (
        <SavedCards state={state} update={update} />
      ) : (
        <>
          {!videos.length && <p className="t-body text-muted">Doppeltipp auf ein Video speichert es hier.</p>}
          <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0">
            {videos.map(({ video: v }) => (
              <li key={v.id} className="relative overflow-hidden rounded-lg bg-black" style={{ aspectRatio: '9 / 16' }}>
                <button className="absolute inset-0" onClick={() => setPlaying(v)} aria-label={v.title}>
                  <img src={v.thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                </button>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 p-2 text-white" style={{ textShadow: '0 1px 2px rgba(0,0,0,.8)' }}>
                  <div className="text-[10px] uppercase tracking-[0.08em]" style={{ color: AREA_COLOR[v.area] }}>{AREA_LABEL[v.area]}</div>
                  <div className="line-clamp-2 text-[12px] font-semibold leading-[15px]">{v.title}</div>
                </div>
                <button
                  aria-label="Entfernen"
                  className="absolute right-1 top-1 rounded-full bg-black/70 px-2 text-[13px] text-white"
                  onClick={() => update((s) => { const m = { ...s.savedVideos }; delete m[v.id]; return { ...s, savedVideos: m }; })}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {playing && <VideoModal video={playing} onClose={() => setPlaying(null)} />}
    </div>
  );
}
