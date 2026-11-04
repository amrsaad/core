import { Icon } from './Icon';

export interface ShareInfo {
  hook: string;
  channel: string;
  /** Der Link, den Brief 05 baut. Ohne ihn zeigt das Blatt die Platzhalterzeile. */
  url?: string;
}

/**
 * Share-Blatt (Brief 06, Board "Share-Sheet"): nur Darstellung. Hook und Kanal oben, darunter der Link, zwei Zeilen (System-Teilen, Link kopieren).
 * Die Logik (navigator.share, Zwischenablage, Link bauen) gehört zu Brief 05 und kommt über onShare und onCopy. Ohne Handler sind die Zeilen aus.
 */
export function ShareSheet({ info, onShare, onCopy, onClose }: { info: ShareInfo; onShare?: () => void; onCopy?: () => void; onClose: () => void }) {
  return (
    <div className="sheet-backdrop" data-testid="share-sheet" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-label="Share">
        <div className="sheet-grip" aria-hidden="true" />
        <h2 className="sheet-title">
          Share
          <small>{info.channel}</small>
        </h2>
        <p className="share-hook">{info.hook}</p>
        <p className="share-url" data-testid="share-url">
          {info.url ?? 'The link appears here once sharing is on.'}
        </p>
        <div className="note-chips">
          <button type="button" className="note-chip" disabled={!onShare} onClick={onShare} data-testid="share-system">
            <Icon name="export" />
            Share link
          </button>
          <button type="button" className="note-chip" disabled={!onCopy} onClick={onCopy} data-testid="share-copy">
            <Icon name="copy" />
            Copy link
          </button>
        </div>
        <button type="button" className="note-chip share-close" onClick={onClose}>
          <Icon name="x" />
          Close
        </button>
      </div>
    </div>
  );
}
