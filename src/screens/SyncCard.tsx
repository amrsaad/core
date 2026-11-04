import { useEffect, useState } from 'react';
import type { SyncUi } from '../lib/sync/useSync';
import { syncKey } from '../lib/vault';

/** "just now", "3 min ago", "2 h ago", "4 d ago". Englisch wie die ganze App. */
export function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** Settings: Token für den Sync zwischen Geräten (Max, 28.10.2026) */
export function SyncCard({ sync }: { sync: SyncUi }) {
  const { status } = sync;
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setTick(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, []);
  // Eine Zeile "vor N min" soll auch nach einem Lauf frisch sein
  useEffect(() => setTick(Date.now()), [status.lastSync, status.error]);

  const save = async () => {
    const ok = await sync.setToken(text);
    if (ok) {
      setText('');
      setMsg('');
    } else if (!(await syncKey())) setMsg('This device still has the old key format. Open your unlock link here once more, then paste the token again.');
    else setMsg('That does not look like a GitHub token. It starts with github_pat_ or ghp_.');
  };

  const btn = 'grp-btn';
  return (
    <section className="grp" data-testid="sync-card">
      <span className="grp-title">Sync between devices</span>
      {!status.hasToken && (
        <>
          <label className="grp-stack">
            <span className="grp-note">GitHub token</span>
            <input
              type="password"
              data-testid="sync-token"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="github_pat_…"
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              aria-label="GitHub token"
              className="grp-input"
            />
          </label>
          <button className={btn} onClick={save} disabled={!text.trim()} data-testid="sync-save">Save token</button>
          <p className="grp-note">Fine-grained token for core-content only, Contents read and write. Or scan the QR code from your other device.</p>
        </>
      )}
      {status.hasToken && (
        <>
          <span className="grp-row" data-testid="sync-last">Last sync: {status.running ? 'syncing…' : status.lastSync ? ago(status.lastSync, tick) : 'not yet'}</span>
          <button className={btn} onClick={() => void sync.syncNow()} disabled={status.running} data-testid="sync-now">Sync now</button>
          <button className={btn} onClick={() => void sync.removeToken()} data-testid="sync-remove">Remove token</button>
        </>
      )}
      {(status.error || msg) && (
        <p className="grp-err" data-testid="sync-error">{status.error || msg}</p>
      )}
    </section>
  );
}
