import { useState } from 'react';
import type { Area } from '../types';
import type { AppState } from '../lib/state';
import { AREA_COLOR, AREA_LABEL } from '../lib/labels';
import { Icon } from '../components/Icon';
import { MomentModal } from './MomentModal';
import { DigestCard } from './DigestCard';
import { fullVideoUrl, thumbOf, type Moment } from './types';
import { lsKey } from '../lib/ns';

type View = 'grid' | 'list';
const VIEW_KEY = lsKey('saved.view');
const readView = (): View => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
};

export function SavedMoments({ state, update }: { state: AppState; update: (fn: (s: AppState) => AppState) => void }) {
  const [playing, setPlaying] = useState<Moment | null>(null);
  const [area, setArea] = useState<Area | 'all'>('all');
  const [view, setView] = useState<View>(readView);
  const items = Object.values(state.savedMoments).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  const shown = items.filter((i) => area === 'all' || i.moment.area === area);
  const pick = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* Speicher gesperrt: die Ansicht gilt nur für diese Sitzung */
    }
  };
  return (
    <div className="pad pad-nav scr">
      <div className="scr-wrap">
        <div className="scr-head">
          <h1 className="scr-title">Saved</h1>
          {items.length > 0 && (
            <span className="sv-headr">
              <span className="scr-count">{items.length}</span>
          <div className="sv-toggle" role="group" aria-label="View">
            <button aria-pressed={view === 'grid'} aria-label="Grid" data-testid="saved-view-grid" onClick={() => pick('grid')}>
              <Icon name="squares-four" />
            </button>
            <button aria-pressed={view === 'list'} aria-label="List" data-testid="saved-view-list" onClick={() => pick('list')}>
              <Icon name="list" />
            </button>
          </div>
            </span>
          )}
        </div>
        <DigestCard state={state} update={update} />
        {items.length > 0 && (
          <div className="sv-bar">
            <div className="sv-filters" role="group" aria-label="Filter">
              {(['all', 'brain', 'body', 'beat'] as const).map((a) => (
                <button key={a} className="sv-chip" aria-pressed={area === a} onClick={() => setArea(a)}>
                  {a === 'all' ? 'All' : AREA_LABEL[a]}
                </button>
              ))}
            </div>
          </div>
        )}
        {!items.length && <p className="scr-empty">Double tap a moment to save it here.</p>}
        {items.length > 0 && !shown.length && <p className="scr-empty">Nothing saved in {area === 'all' ? 'this view' : AREA_LABEL[area]} yet.</p>}
        <ul className="sv-items" data-view={view} data-testid="saved-items">
          {shown.map(({ moment: m, done }) => (
            <li key={m.id} className="sv-card" style={{ ['--area' as string]: AREA_COLOR[m.area] }}>
              <button className="sv-thumb" onClick={() => setPlaying(m)} aria-label={`Watch ${m.hook}`}>
                <img src={thumbOf(m)} alt="" loading="lazy" />
                <Icon name="play" />
              </button>
              <div className="sv-body">
                <span className="sv-meta">
                  <span className="sv-dot" aria-hidden />
                  <span>
                    <b>{AREA_LABEL[m.area]}</b> · {m.channel}
                    {done ? ' · applied' : ''}
                  </span>
                  {state.momentAsked?.[m.id] ? (
                    <span className="saved-asked" data-testid="saved-asked" title="You asked Claude about this moment">
                      · asked
                    </span>
                  ) : null}
                </span>
                <p className="sv-hook">{m.hook}</p>
                {m.forYou && <p className="sv-for">{m.forYou}</p>}
                <span className="sv-acts">
                  {fullVideoUrl(m) && (
                    <a href={fullVideoUrl(m)} target="_blank" rel="noopener noreferrer">
                      {m.form === 'text' ? 'Source' : m.audio ? 'Full episode' : 'Full video'}
                    </a>
                  )}
                  <button onClick={() => update((s) => { const x = { ...s.savedMoments }; delete x[m.id]; return { ...s, savedMoments: x }; })}>Remove</button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
      {playing && <MomentModal moment={playing} onClose={() => setPlaying(null)} />}
    </div>
  );
}
