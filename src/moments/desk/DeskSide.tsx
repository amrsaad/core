import type { ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import type { IconName } from '../../components/icons';
import type { Form } from '../form';
import { atTime } from '../hook';
import { sourceLine } from '../source';
import { fullVideoUrl, type Moment } from '../types';
import { AREA_DK } from './area';
import { keyHints, openLabel } from './model';

/**
 * Rechte Spalte der Mac-Ansicht (Runde 44): Quelle, Aktionen untereinander mit Tastenkürzel, unten die Tastaturhilfe.
 * Eine offene Abrufkarte steht ganz oben, kein Overlay über dem Bild. Alle Knöpfe rufen Funktionen des Feeds.
 */

function Act({ testid, label, keyCap, icon, on, pressed, onClick, children }: { testid: string; label: string; keyCap?: string; icon?: IconName; on?: boolean; pressed?: boolean; onClick: () => void; children?: ReactNode }) {
  return (
    <button type="button" className="ds-act" data-testid={testid} data-on={on ? '1' : undefined} aria-pressed={pressed} onClick={onClick}>
      {children ?? (icon ? <Icon name={icon} size="var(--icon-sm)" /> : null)}
      <span className="ds-act-label">{label}</span>
      {keyCap && (
        <kbd aria-hidden="true" className="ds-kbd">
          {keyCap}
        </kbd>
      )}
    </button>
  );
}

const FULLSCREEN = (
  <svg className="icon" style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" />
  </svg>
);

export interface DeskSideProps {
  m: Moment | undefined;
  form: Form;
  liked: boolean;
  saved: boolean;
  fullscreen: boolean;
  hasCaptions: boolean;
  seekable: boolean;
  recall: ReactNode;
  onLike: () => void;
  onSave: () => void;
  onShare: () => void;
  onMore: () => void;
  onOpen: () => void;
  onFullscreen: () => void;
}

export function DeskSide(p: DeskSideProps) {
  const { m, form } = p;
  if (!m) return <div className="ds" data-testid="desk-panel" />;
  const sl = form === 'text' ? sourceLine(m) : null;
  const hasUrl = !!fullVideoUrl(m);
  return (
    <div className="ds" data-testid="desk-panel" style={{ ['--ad' as string]: AREA_DK[m.area] }}>
      {p.recall && (
        <section className="ds-sec ds-recall" data-testid="desk-recall">
          {p.recall}
        </section>
      )}
      <section className="ds-sec" aria-labelledby="ds-source-h">
        <h2 id="ds-source-h">Source</h2>
        <div data-testid="desk-source">
          {sl ? (
            sl.url ? (
              <a className="ds-title" data-testid="text-source" href={sl.url} target="_blank" rel="noopener noreferrer" dir="auto">
                {`${sl.prefix}${sl.text}`}
              </a>
            ) : (
              <p className="ds-title" data-testid="text-source" dir="auto">{`${sl.prefix}${sl.text}`}</p>
            )
          ) : (
            <>
              <p className="ds-title" data-testid="desk-source-title" dir="auto">
                {m.videoTitle}
              </p>
              <p className="ds-sub">Clip from {atTime(m.start)}</p>
            </>
          )}
        </div>
        {hasUrl && (
          <button type="button" className="ds-open" data-testid="desk-open-source" onClick={p.onOpen}>
            <Icon name="arrow-square-out" size="var(--icon-sm)" />
            <span>{openLabel(form)}</span>
            <kbd aria-hidden="true">O</kbd>
          </button>
        )}
      </section>
      <section className="ds-sec" aria-labelledby="ds-actions-h">
        <h2 id="ds-actions-h">Actions</h2>
        <div className="ds-acts">
          <Act testid="like" label="Like" keyCap="L" icon="heart" on={p.liked} pressed={p.liked} onClick={p.onLike} />
          <Act testid="save" label="Save" keyCap="S" icon="bookmark-simple" on={p.saved} pressed={p.saved} onClick={p.onSave} />
          <Act testid="share" label="Share" keyCap="T" icon="export" onClick={p.onShare} />
          <Act testid="more" label="More" keyCap="F" icon="dots-three-circle" onClick={p.onMore} />
          {form === 'video' && (
            <Act testid="fullscreen" label={p.fullscreen ? 'Exit full screen' : 'Full screen'} keyCap="V" onClick={p.onFullscreen}>
              {FULLSCREEN}
            </Act>
          )}
        </div>
      </section>
      <section className="ds-sec ds-keys" data-testid="desk-keys" aria-labelledby="ds-keys-h">
        <h2 id="ds-keys-h">Keyboard</h2>
        <dl>
          {keyHints(form, p.hasCaptions, p.seekable).map((r) => (
            <div key={r.label}>
              <dt>{r.label}</dt>
              <dd>{r.keys}</dd>
            </div>
          ))}
          <div>
            <dt>All shortcuts</dt>
            <dd>?</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
