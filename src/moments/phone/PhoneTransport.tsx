import { Icon } from '../../components/Icon';
import { atTime } from '../hook';
import type { Moment } from '../types';
import { clipLen, inClip } from '../desk/model';

/**
 * Runde 45: feste Abspielleiste der iPhone-Ansicht (Audio und Video) und die Leiste Previous und Next (Text).
 * Zeitleiste des Ausschnitts nur als Anzeige (kein Springen), Rechnung aus desk/model.ts wie am Desktop.
 * Reine Anzeige: jede Taste ruft eine Funktion des Feeds. Die Berührung der Tasten steuert der Feed (Klick, synchron), nie ein Zeitgeber.
 */
export interface PhoneTransportProps {
  m: Moment;
  /** Anteil 0 bis 1 im Ausschnitt */
  frac: number;
  paused: boolean;
  rate: number;
  canPrev: boolean;
  /** Taste CC nur, wenn der Moment Untertitel hat */
  cc?: { on: boolean; onToggle: () => void };
  onPlay: () => void;
  /** Beginn der Berührung der Play-Taste (der Feed merkt sich, ob es die erste Geste der Seite war) */
  onPlayDown: () => void;
  onPrev: () => void;
  onNext: () => void;
  onRate: () => void;
}

const stop = { onPointerDown: (e: React.PointerEvent) => e.stopPropagation(), onPointerUp: (e: React.PointerEvent) => e.stopPropagation() };

export function PhoneTransport(p: PhoneTransportProps) {
  const len = clipLen(p.m);
  const now = inClip(p.frac, p.m);
  const pct = `${(Math.min(1, Math.max(0, p.frac)) * 100).toFixed(2)}%`;
  return (
    <footer className="ph-bar" data-testid="ph-bar" aria-label="Playback">
      <div className="ph-time">
        <span data-testid="ph-time-now">{atTime(now)}</span>
        <div className="ph-line" data-testid="ph-timeline" role="progressbar" aria-label="Position in this clip" aria-valuemin={0} aria-valuemax={Math.round(len)} aria-valuenow={now} aria-valuetext={`${atTime(now)} of ${atTime(len)}`}>
          <div className="ph-fill" data-testid="ph-fill" style={{ width: pct }} />
        </div>
        <span data-testid="ph-time-len">{atTime(len)}</span>
      </div>
      <div className="ph-ctl">
        <button type="button" className="ph-pill ph-rate" data-testid="rate" data-primary="true" aria-label={`Speed ${p.rate}x, tap to change`} {...stop} onClick={p.onRate}>
          {p.rate}x
        </button>
        <div className="ph-main">
          <button type="button" className="ph-round" data-testid="ctl-prev" data-primary="true" aria-label="Previous moment" disabled={!p.canPrev} {...stop} onClick={p.onPrev}>
            <Icon name="skip-back" size="var(--rail-icon)" />
          </button>
          <button
            type="button"
            className="ph-round ph-play"
            data-testid="ctl-play"
            data-primary="true"
            aria-label={p.paused ? 'Play' : 'Pause'}
            onPointerDown={(e) => {
              e.stopPropagation();
              p.onPlayDown();
            }}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={p.onPlay}
          >
            <Icon name={p.paused ? 'play' : 'pause'} size="var(--rail-icon)" />
          </button>
          <button type="button" className="ph-round" data-testid="ctl-next" data-primary="true" aria-label="Next moment" {...stop} onClick={p.onNext}>
            <Icon name="skip-forward" size="var(--rail-icon)" />
          </button>
        </div>
        {p.cc ? (
          <button type="button" className="ph-pill ph-cc" data-testid="cc" data-primary="true" aria-label="Captions" aria-pressed={p.cc.on} {...stop} onClick={p.cc.onToggle}>
            CC
          </button>
        ) : (
          <span className="ph-end" aria-hidden="true" />
        )}
      </div>
    </footer>
  );
}

/** Text-Reiter: statt der Abspielleiste Previous und Next (der Text hat keinen Player) */
export function PhoneTextBar({ canPrev, onPrev, onNext }: { canPrev: boolean; onPrev: () => void; onNext: () => void }) {
  return (
    <footer className="ph-bar ph-bar-text" data-testid="ph-bar" aria-label="Moments">
      <div className="ph-ctl">
        <button type="button" className="ph-wide" data-testid="ctl-prev" data-primary="true" disabled={!canPrev} {...stop} onClick={onPrev}>
          <Icon name="arrow-up" size="var(--icon-sm)" />
          Previous
        </button>
        <button type="button" className="ph-wide" data-testid="ctl-next" data-primary="true" {...stop} onClick={onNext}>
          Next
          <Icon name="arrow-down" size="var(--icon-sm)" />
        </button>
      </div>
    </footer>
  );
}
