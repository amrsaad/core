import { useCallback, useEffect, useState } from 'react';
import { Feed } from './feed/Feed';
import { loadLibrary, type Library } from './lib/cards';
import { useAppState } from './lib/useAppState';
import { loadPool } from './lib/videos';
import { Saved } from './screens/SavedTabs';
import { Settings } from './screens/Settings';
import { VideoFeed } from './video/VideoFeed';
import type { VideoPool } from './videoTypes';

type Tab = 'feed' | 'saved' | 'cards' | 'settings';

const ICONS: Record<Tab, JSX.Element> = {
  feed: <path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM10 9v6l5-3z" />,
  saved: <path d="M7 4h10v16l-5-4-5 4z" />,
  cards: <path d="M5 4h14v16H5zM5 12h14" />,
  settings: <path d="M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4" />,
};
const NAMES: Record<Tab, string> = { feed: 'Feed', saved: 'Gespeichert', cards: 'Karten', settings: 'Einstellungen' };
const NAV_H = 56;

export default function App() {
  const [state, update, replace] = useAppState();
  const [pool, setPool] = useState<VideoPool | null>(null);
  const [lib, setLib] = useState<Library | null>(null);
  const [tab, setTab] = useState<Tab>('feed');
  const [videoPaused, setVideoPaused] = useState(false);
  const [cardChrome, setCardChrome] = useState(true);

  useEffect(() => {
    loadPool().then(setPool);
    // Karten im Hintergrund laden, der Video-Feed wartet nicht darauf
    loadLibrary().then(setLib, () => setLib({ cards: [], index: { updatedAt: '', files: [], total: 0 } }));
  }, []);

  const onPausedChange = useCallback((p: boolean) => setVideoPaused(p), []);

  if (!state || !pool) return <div className="h-[100dvh] bg-black" />;

  const showBar = tab === 'feed' ? videoPaused : tab === 'cards' ? cardChrome : true;
  const dark = tab === 'feed';
  return (
    <div className="relative h-[100dvh] overflow-hidden" style={{ ['--nav-h' as string]: tab === 'feed' && showBar ? `${NAV_H}px` : '0px' }}>
      {/* Video-Feed bleibt gemountet, damit die Player beim Tabwechsel nicht neu laden */}
      <div className={tab === 'feed' ? '' : 'hidden'}>
        <VideoFeed pool={pool.videos} state={state} update={update} active={tab === 'feed'} onPausedChange={onPausedChange} />
      </div>
      {tab === 'cards' && (lib ? <Feed cards={lib.cards} state={state} update={update} onToggleChrome={() => setCardChrome((c) => !c)} /> : <div className="h-[100dvh]" />)}
      {tab === 'saved' && <Saved state={state} update={update} />}
      {tab === 'settings' && <Settings state={state} update={update} replace={replace} index={lib?.index ?? null} pool={pool} />}
      <nav
        className={`absolute inset-x-0 bottom-0 z-[60] flex justify-around border-t transition-transform duration-200 ${showBar ? '' : 'translate-y-full'} ${dark ? 'border-[#222] bg-black' : 'border-[var(--line)] bg-[var(--bg)]'}`}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {(Object.keys(ICONS) as Tab[]).map((t) => (
          <button
            key={t}
            aria-label={NAMES[t]}
            onClick={() => setTab(t)}
            className={`flex flex-1 justify-center py-3 ${tab === t ? (dark ? 'text-white' : 'text-[var(--fg)]') : dark ? 'text-[#B3B3B3]' : 'text-muted'}`}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              {ICONS[t]}
            </svg>
          </button>
        ))}
      </nav>
    </div>
  );
}
