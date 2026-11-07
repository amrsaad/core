import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { shortLink } from '../share/link';

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
    <Sheet testid="share-sheet" label="Share" onClose={onClose}>
        <h2 className="sheet-title">
          Share
          <small>{info.channel}</small>
        </h2>
        <p className="share-hook">{info.hook}</p>
        {/* Der Hash trägt den ganzen Moment, darum steht hier nur der Anfang, der volle Link in data-url (Brief 05) */}
        <p className="share-url" data-testid="share-url" data-url={info.url} title={info.url}>
          {info.url ? shortLink(info.url) : 'The link appears here once sharing is on.'}
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
    </Sheet>
  );
}
