import { useEffect, useState } from 'react';
import qrcode from 'qrcode-generator';
import { keyBackups, unlockLink } from '../lib/vault';

/** Settings: weiteres Gerät freischalten, per QR-Code oder Teilen des Links (Max, 26.10.2026) */
export function UnlockDevice({ tokenKey }: { tokenKey?: boolean }) {
  const [link, setLink] = useState<string | null | undefined>(undefined);
  const [backups, setBackups] = useState<{ idb: boolean; cache: boolean } | null>(null);
  const [qr, setQr] = useState(false);
  const [msg, setMsg] = useState('');

  // Der QR-Code trägt das Sync-Token mit (verschlüsselt mit dem Pool-Schlüssel), der geteilte Link nicht
  const [qrLink, setQrLink] = useState<string | null>(null);
  useEffect(() => {
    unlockLink().then(setLink).catch(() => setLink(null));
    unlockLink(true).then(setQrLink).catch(() => setQrLink(null));
    keyBackups().then(setBackups).catch(() => {});
  }, [tokenKey]);

  const svg = (() => {
    if (!qrLink || !qr) return '';
    const q = qrcode(0, 'M');
    q.addData(qrLink);
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

  const btn = 'grp-btn';
  return (
    <section className="grp" data-testid="unlock-device">
      <span className="grp-title">Unlock another device</span>
      {link === null && <p className="grp-note">This device only has the old key format. Open your unlock link here once more, then you can share it.</p>}
      {link && (
        <>
          <button className={btn} onClick={() => setQr(!qr)}>{qr ? 'Hide QR code' : 'Show QR code'}</button>
          {svg && <div className="qr-box" data-testid="unlock-qr" dangerouslySetInnerHTML={{ __html: svg }} />}
          <button className={btn} onClick={share}>Share unlock link</button>
          <p className="grp-note">Anyone with this link can open your moments. Only send it to your own devices.{qrLink?.includes('&t=') ? ' The QR code also carries your sync token. Only show it to your own devices.' : ''}</p>
        </>
      )}
      {backups && (
        <p className="grp-note" data-testid="key-backups">
          Key saved in IndexedDB {backups.idb ? 'yes' : 'no'} · in offline cache {backups.cache ? 'yes' : 'no'}
        </p>
      )}
      {msg && <p className="grp-note">{msg}</p>}
    </section>
  );
}
