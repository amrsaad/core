import { useEffect, useState } from 'react';
import { Feed } from './feed/Feed';
import { loadLibrary, type Library } from './lib/cards';
import { useAppState } from './lib/useAppState';
import { Saved } from './screens/Saved';
import { Settings } from './screens/Settings';

type Tab = 'feed' | 'saved' | 'settings';

const ICONS: Record<Tab, JSX.Element> = {
  feed: <path d="M5 4h14v16H5zM5 12h14" />,
  saved: <path d="M7 4h10v16l-5-4-5 4z" />,
  settings: <path d="M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4" />,
};
const NAMES: Record<Tab, string> = { feed: 'Feed', saved: 'Gespeichert', settings: 'Einstellungen' };

export default function App() {
  const [state, update, replace] = useAppState();
  const [lib, setLib] = useState<Library | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('feed');
  const [chrome, setChrome] = useState(true);

  useEffect(() => {
    loadLibrary().then(setLib, () => setError('Karten konnten nicht geladen werden. Beim ersten Start ist Internet nötig.'));
  }, []);

  if (error) return <div className="pad t-body flex h-[100dvh] items-center text-muted">{error}</div>;
  if (!state || !lib) return <div className="h-[100dvh] bg-[var(--bg)]" />;

  const showBar = tab !== 'feed' || chrome;
  return (
    <div className="relative h-[100dvh] overflow-hidden">
      {tab === 'feed' && <Feed cards={lib.cards} state={state} update={update} onToggleChrome={() => setChrome((c) => !c)} />}
      {tab === 'saved' && <Saved state={state} update={update} />}
      {tab === 'settings' && <Settings state={state} update={update} replace={replace} index={lib.index} />}
      <nav
        className={`absolute inset-x-0 bottom-0 z-10 flex justify-around border-t border-[var(--line)] bg-[var(--bg)] transition-transform duration-200 ${showBar ? '' : 'translate-y-full'}`}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {(Object.keys(ICONS) as Tab[]).map((t) => (
          <button key={t} aria-label={NAMES[t]} onClick={() => setTab(t)} className={`flex flex-1 justify-center py-3 ${tab === t ? 'text-[var(--fg)]' : 'text-muted'}`}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              {ICONS[t]}
            </svg>
          </button>
        ))}
      </nav>
    </div>
  );
}
