import { useMemo, useState } from 'react';
import type { Area } from '../types';
import type { AppState } from '../lib/state';
import { AREA_COLOR, AREA_LABEL } from '../lib/labels';
import { Icon } from '../components/Icon';
import { MomentModal } from './MomentModal';
import { DigestCard } from './DigestCard';
import { thumbOf, type Moment } from './types';
import { lsKey } from '../lib/ns';
import { savedView } from './saved';

type View = 'grid' | 'list';
const VIEW_KEY = lsKey('saved.view');
const readView = (): View => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
};

export function SavedMoments({ state, update, pool }: { state: AppState; update: (fn: (s: AppState) => AppState) => void; pool: Moment[] }) {
  const [playing, setPlaying] = useState<Moment | null>(null);
  const [area, setArea] = useState<Area | 'all'>('all');
  const [view, setView] = useState<View>(readView);
  const poolById = useMemo(() => new Map(pool.map((m) => [m.id, m])), [pool]);
  // Ein Eintrag ohne moment und ohne stub darf es nicht geben, fällt aber nicht auf (leere Felder, nur Entfernen)
  const items = Object.entries(state.savedMoments)
    .filter(([, e]) => !!e)
    .map(([id, e]) => ({ ...savedView(e, id, poolById), savedAt: e.savedAt, done: e.done }))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  const shown = items.filter((i) => area === 'all' || i.area === area);
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
          {shown.map(({ id, moment: m, hook, channel, videoTitle, area: a, url, done }) => (
            <li key={id} className="sv-card" style={{ ['--area' as string]: AREA_COLOR[a as Area] ?? 'var(--line)' }}>
              {m ? (
                <button className="sv-thumb" onClick={() => setPlaying(m)} aria-label={`Watch ${hook}`}>
                  <img src={thumbOf(m)} alt="" loading="lazy" />
                  <Icon name="play" />
                </button>
              ) : (
                <div className="sv-thumb" aria-hidden />
              )}
              <div className="sv-body">
                <span className="sv-meta">
                  <span className="sv-dot" aria-hidden />
                  <span>
                    <b>{AREA_LABEL[a as Area] ?? 'Saved'}</b> · {channel || videoTitle}
                    {done ? ' · applied' : ''}
                  </span>
                  {state.momentAsked?.[id] ? (
                    <span className="saved-asked" data-testid="saved-asked" title="You asked Claude about this moment">
                      · asked
                    </span>
                  ) : null}
                </span>
                <p className="sv-hook">{hook}</p>
                {!m && <p className="sv-for">No longer in the feed</p>}
                {m?.forYou && <p className="sv-for">{m.forYou}</p>}
                <span className="sv-acts">
                  {url && (
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      {!m ? 'Source' : m.form === 'text' ? 'Source' : m.audio ? 'Full episode' : 'Full video'}
                    </a>
                  )}
                  <button onClick={() => update((s) => { const x = { ...s.savedMoments }; delete x[id]; return { ...s, savedMoments: x }; })}>Remove</button>
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
