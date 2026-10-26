import { useEffect, useState } from 'react';
import qrcode from 'qrcode-generator';
import { keyBackups, unlockLink } from '../lib/vault';

/** Settings: weiteres Gerät freischalten, per QR-Code oder Teilen des Links (Max, 26.10.2026) */
export function UnlockDevice() {
  const [link, setLink] = useState<string | null | undefined>(undefined);
  const [backups, setBackups] = useState<{ idb: boolean; cache: boolean } | null>(null);
  const [qr, setQr] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    void unlockLink().then(setLink);
    void keyBackups().then(setBackups);
  }, []);

  const svg = (() => {
    if (!link || !qr) return '';
    const q = qrcode(0, 'M');
    q.addData(link);
    q.make();
    return q.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
  })();

  const share = async () => {
    if (!link) return;
    try {
      if (navigator.share) await navigator.share({ title: 'Unlock Core', url: link });
      else {
        await navigator.clipboard.writeText(link);
        setMsg('Link copied.');
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setMsg('Sharing failed. Use the QR code.');
    }
  };

  const btn = 'rounded-xl border border-[var(--line)] px-4 py-3 text-[16px] text-left';
  return (
    <section className="flex flex-col gap-3 rounded-xl bg-surface p-4" data-testid="unlock-device">
      <span className="text-[17px]">Unlock another device</span>
      {link === null && <p className="t-meta m-0 text-muted">This device only has the old key format. Open your unlock link here once more, then you can share it.</p>}
      {link && (
        <>
          <button className={btn} onClick={() => setQr(!qr)}>{qr ? 'Hide QR code' : 'Show QR code'}</button>
          {svg && <div className="mx-auto w-full max-w-[260px] rounded-lg bg-white p-2" data-testid="unlock-qr" dangerouslySetInnerHTML={{ __html: svg }} />}
          <button className={btn} onClick={share}>Share unlock link</button>
          <p className="t-meta m-0 text-muted">Anyone with this link can open your moments. Only send it to your own devices.</p>
        </>
      )}
      {backups && (
        <p className="t-meta m-0 text-muted" data-testid="key-backups">
          Key saved in IndexedDB {backups.idb ? 'yes' : 'no'} · in offline cache {backups.cache ? 'yes' : 'no'}
        </p>
      )}
      {msg && <p className="t-meta m-0 text-muted">{msg}</p>}
    </section>
  );
}
