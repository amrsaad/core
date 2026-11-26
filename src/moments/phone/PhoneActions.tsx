import { Icon } from '../../components/Icon';
import type { IconName } from '../../components/icons';

/**
 * Runde 45: Aktionsreihe der iPhone-Ansicht, direkt über der Abspielleiste. Vier gleich breite Tasten mit Symbol und Beschriftung.
 * Reine Anzeige: jede Taste ruft eine Funktion des Feeds (like, toggleSave, openShare, openNote) synchron im Klick auf.
 */
export interface PhoneActionsProps {
  liked: boolean;
  saved: boolean;
  shared: boolean;
  onLike: (e: React.MouseEvent) => void;
  onSave: (e: React.MouseEvent) => void;
  onShare: (e: React.MouseEvent) => void;
  onMore: () => void;
}

function Act({ testid, label, aria, icon, on, pressed, onClick }: { testid: string; label: string; aria?: string; icon: IconName; on?: boolean; pressed?: boolean; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      type="button"
      className="ph-act no-callout"
      data-testid={testid}
      data-primary="true"
      data-on={on ? '1' : undefined}
      aria-label={aria ?? label}
      aria-pressed={pressed === undefined ? undefined : pressed}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={onClick}
    >
      <Icon name={icon} size="var(--icon)" />
      <span>{label}</span>
    </button>
  );
}

export function PhoneActions(p: PhoneActionsProps) {
  return (
    <div className="ph-actions" data-testid="ph-actions" role="group" aria-label="Actions">
      <Act testid="like" label="Like" icon="heart" on={p.liked} pressed={p.liked} onClick={p.onLike} />
      <Act testid="save" label="Save" icon="bookmark-simple" on={p.saved} pressed={p.saved} onClick={p.onSave} />
      <Act testid="share" label="Share" icon="export" on={p.shared} onClick={p.onShare} />
      <Act testid="more" label="More" aria="More options" icon="dots-three-circle" onClick={() => p.onMore()} />
    </div>
  );
}
