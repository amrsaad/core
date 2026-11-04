import { useState } from 'react';
import { storeKeyFrom } from '../lib/vault';
import { Icon } from '../components/Icon';

/** Home-Bildschirm-Apps auf iOS haben eigenen Speicher. Daher Freischalten per eingefügtem Link direkt in der App. */
export function Unlock() {
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
    <div className="pad unlock" data-testid="unlock-screen">
      <div className="unlock-card">
        <span className="unlock-icon" aria-hidden>
          <Icon name="lock" size="var(--s-8)" />
        </span>
        <h1 className="unlock-title">Core</h1>
        <p className="unlock-sub">Beat · Body · Brain</p>
        <p className="unlock-text">This device is locked. Open Core on a device that is already unlocked, go to Settings, Unlock another device, and copy the link. Then paste it here.</p>
        <button onClick={paste} className="btn-primary unlock-btn">
          Paste link
        </button>
        <input
          className="grp-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const t = e.clipboardData.getData('text');
            if (t) void tryText(t);
          }}
          placeholder="or paste it here"
          aria-label="Unlock link"
          autoCapitalize="off"
          autoCorrect="off"
        />
        {text && (
          <button onClick={() => tryText(text)} className="grp-btn strong" style={{ textAlign: 'center' }}>
            Unlock
          </button>
        )}
        {msg && <p className="grp-err">{msg}</p>}
      </div>
    </div>
  );
}

export function Locked({ text }: { text: string }) {
  return (
    <div className="pad unlock" data-testid="locked-screen">
      <div className="unlock-card">
        <span className="unlock-icon" aria-hidden>
          <Icon name="cloud-slash" size="var(--s-8)" />
        </span>
        <p className="unlock-text">{text}</p>
      </div>
    </div>
  );
}
