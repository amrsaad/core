import { registerHls } from './video/ytApi';
import { useCallback, useEffect, useState } from 'react';
import { now as clockNow } from './lib/clock';
import { useAppState } from './lib/useAppState';
import { decryptJson, storeKeyFrom, unlockKey } from './lib/vault';
import { MomentFeed } from './moments/MomentFeed';
import { isReviewDue } from './moments/review';
import { SavedMoments } from './moments/SavedMoments';
import type { MomentPool } from './moments/types';
import { WeeklyReview } from './moments/WeeklyReview';
import { Settings } from './screens/Settings';

// v1 (Karten) und v2 (Shorts) bleiben im Code, sind aber nicht mehr in der Navigation.
type Tab = 'feed' | 'saved' | 'settings';

const ICONS: Record<Tab, JSX.Element> = {
  feed: <path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM10 9v6l5-3z" />,
  saved: <path d="M7 4h10v16l-5-4-5 4z" />,
  settings: <path d="M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4" />,
};
const NAMES: Record<Tab, string> = { feed: 'Feed', saved: 'Saved', settings: 'Settings' };
const NAV_H = 56;

type Vault = { status: 'loading' } | { status: 'locked' } | { status: 'error'; message: string } | { status: 'open'; pool: MomentPool };

export default function App() {
  const [state, update, replace] = useAppState();
  const [vault, setVault] = useState<Vault>({ status: 'loading' });
  const [tab, setTab] = useState<Tab>('feed');
  const [paused, setPaused] = useState(false);
  const [review, setReview] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const key = await unlockKey();
        if (!key) return setVault({ status: 'locked' });
        const pool = await decryptJson<MomentPool>(key, `${import.meta.env.BASE_URL}moments/pool.enc`);
        if (pool) registerHls(pool.moments);
        setVault({ status: 'open', pool: pool ?? { updatedAt: '', lastRun: null, moments: [] } });
      } catch (e) {
        setVault({ status: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    })();
  }, []);

  // Sonntags beim ersten Öffnen: Wochenrückblick
  useEffect(() => {
    if (state && review === null) setReview(isReviewDue(state, clockNow()));
  }, [state, review]);

  const onPausedChange = useCallback((p: boolean) => setPaused(p), []);

  if (!state || vault.status === 'loading' || review === null) return <div className="h-[100dvh] bg-black" />;
  if (vault.status === 'locked') return <Unlock />;
  if (vault.status === 'error') return <Locked text={`Could not load the pool (${vault.message}). The first start needs internet.`} />;
  if (review) return <WeeklyReview state={state} update={update} now={clockNow()} onDone={() => setReview(false)} />;

  const showBar = tab === 'feed' ? paused : true;
  const dark = tab === 'feed';
  return (
    <div className="relative h-[100dvh] overflow-hidden" style={{ ['--nav-h' as string]: tab === 'feed' && showBar ? `${NAV_H}px` : '0px' }}>
      <div className={tab === 'feed' ? '' : 'hidden'}>
        <MomentFeed pool={vault.pool.moments} state={state} update={update} active={tab === 'feed'} onPausedChange={onPausedChange} />
      </div>
      {tab === 'saved' && <SavedMoments state={state} update={update} />}
      {tab === 'settings' && <Settings state={state} update={update} replace={replace} moments={vault.pool} />}
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

/** Home-Bildschirm-Apps auf iOS haben eigenen Speicher. Daher Freischalten per eingefügtem Link direkt in der App. */
function Unlock() {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const tryText = async (t: string) => {
    if (await storeKeyFrom(t)) location.reload();
    else setMsg('That is not a valid unlock link. Please paste the whole link.');
  };
  const paste = async () => {
    try {
      await tryText(await navigator.clipboard.readText());
    } catch {
      setMsg('Pasting is blocked. Paste the link into the field below.');
    }
  };
  return (
    <div className="pad flex h-[100dvh] flex-col justify-center gap-4 bg-black text-[17px] leading-[25px] text-[#B3B3B3]">
      <p>Core is not unlocked on this device yet. Copy your unlock link, then paste it here.</p>
      <button onClick={paste} className="rounded-xl bg-white py-3 font-semibold text-black">Paste link</button>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const t = e.clipboardData.getData('text');
          if (t) void tryText(t);
        }}
        placeholder="or paste it here"
        autoCapitalize="off"
        autoCorrect="off"
        className="rounded-xl border border-[#333] bg-[#111] px-3 py-3 text-white"
      />
      {text && <button onClick={() => tryText(text)} className="rounded-xl border border-[#555] py-3 text-white">Unlock</button>}
      {msg && <p className="text-[15px] text-[#E07B7B]">{msg}</p>}
    </div>
  );
}

function Locked({ text }: { text: string }) {
  return <div className="pad flex h-[100dvh] items-center bg-black text-[17px] leading-[25px] text-[#B3B3B3]">{text}</div>;
}
