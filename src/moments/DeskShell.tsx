import type { ReactNode } from 'react';
import { AREA_COLOR, AREA_LABEL } from '../lib/labels';
import { HELP_ROWS } from './desktop';
import { FORM_LABEL, FORMS, momentText, type Form } from './form';
import { atTime } from './hook';
import { sourceLine } from './source';
import { isArabic, type Moment } from './types';

/**
 * Bausteine des Desktop-Modus ab 900 px (Auftrag Max 28.10.2026): Leiste oben mit Reitern und Tageszahl, Seitenblatt für
 * Settings und Saved, Übersicht der Tasten, festes Panel rechts mit Hook, Caption, Quelle und Abrufkarte.
 * Mobil wird nichts davon gezeichnet.
 */

export type DeskTab = 'feed' | 'saved' | 'settings';

const X = <path d="M6 6l12 12M18 6 6 18" />;

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export function DeskBar({ form, setForm, todayText, tab, setTab, onHelp }: { form: Form; setForm: (f: Form) => void; todayText: string; tab: DeskTab; setTab: (t: DeskTab) => void; onHelp: () => void }) {
  return (
    <header className="dbar" data-testid="desk-bar" data-nowheel>
      <div className="dbar-left">
        <span className="dbar-logo">core</span>
      </div>
      <div className="dbar-tabs" role="radiogroup" aria-label="Tab" data-testid="desk-tabs">
        {FORMS.map((f, i) => (
          <button key={f} type="button" role="radio" aria-checked={form === f} className={form === f ? 'on' : ''} data-testid={`desk-tab-${f}`} title={`${FORM_LABEL[f]} (${i + 1})`} onClick={() => setForm(f)}>
            {FORM_LABEL[f]}
            <kbd aria-hidden="true">{i + 1}</kbd>
          </button>
        ))}
      </div>
      <div className="dbar-right">
        <span className="dbar-today" data-testid="desk-today">
          {todayText}
        </span>
        <div className="dbar-actions">
          <button type="button" className={tab === 'saved' ? 'on' : ''} data-testid="desk-saved" aria-pressed={tab === 'saved'} onClick={() => setTab(tab === 'saved' ? 'feed' : 'saved')}>
            <Icon>
              <path d="M7 4h10v16l-5-4-5 4z" />
            </Icon>
            Saved
          </button>
          <button type="button" className={tab === 'settings' ? 'on' : ''} data-testid="desk-settings" aria-pressed={tab === 'settings'} onClick={() => setTab(tab === 'settings' ? 'feed' : 'settings')}>
            <Icon>
              <path d="M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4" />
            </Icon>
            Settings
          </button>
          <button type="button" className="icon" data-testid="desk-help-open" aria-label="Keyboard and trackpad" title="Keyboard and trackpad (?)" onClick={onHelp}>
            ?
          </button>
        </div>
      </div>
    </header>
  );
}

/** Seitenblatt rechts, der Feed bleibt links davon stehen. Esc, Tipp daneben oder der Knopf schließen. */
export function DeskSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <>
      <div className="dsheet-backdrop" data-testid="desk-sheet-backdrop" data-nowheel onClick={onClose} />
      <aside className="dsheet" role="dialog" aria-label={title} data-testid="desk-sheet" data-nowheel>
        <button type="button" className="dsheet-close" data-testid="desk-sheet-close" aria-label={`Close ${title}`} onClick={onClose}>
          <Icon>{X}</Icon>
        </button>
        <div className="dsheet-body">{children}</div>
      </aside>
    </>
  );
}

/** Übersicht der Tasten und des Trackpads. Beim ersten Start im Desktop-Modus einmalig, danach mit ? */
export function DeskHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="dhelp-backdrop" data-testid="desk-help-backdrop" data-nowheel onClick={onClose}>
      <div className="dhelp" role="dialog" aria-modal="true" aria-label="Keyboard and trackpad" data-testid="desk-help" onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard and trackpad</h2>
        <dl>
          {HELP_ROWS.map((r, i) => (
            <div key={i}>
              <dt>{r.keys}</dt>
              <dd>{r.text}</dd>
            </div>
          ))}
        </dl>
        <button type="button" className="dhelp-close" data-testid="desk-help-close" autoFocus onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/**
 * Panel rechts. Hook und Quelle stehen immer da. Die Caption klappt mit C auf (Lesetext und Angaben). Die Abrufkarte steht
 * darunter, kein Overlay über dem Video.
 */
export function DeskPanel({ m, speaker, form, capOpen, onCaption, onSource, recall }: { m: Moment | undefined; speaker: string; form: Form; capOpen: boolean; onCaption: () => void; onSource: () => void; recall: ReactNode }) {
  if (!m) return <div className="dp" data-testid="desk-panel" />;
  const text = form === 'text' ? '' : momentText(m);
  const ar = isArabic(text);
  const sl = form === 'text' ? sourceLine(m) : null;
  return (
    <div className="dp" data-testid="desk-panel" style={{ ['--area' as string]: AREA_COLOR[m.area] }}>
      <div className="dp-meta" data-testid="desk-speaker">
        <span className="vdot" aria-hidden="true" />
        <span style={{ color: AREA_COLOR[m.area] }}>{AREA_LABEL[m.area]}</span>
        <span className="dp-speaker">{speaker}</span>
      </div>
      <h2 className="dp-hook" data-testid="desk-hook">
        {m.hook}
      </h2>

      <section className="dp-sec">
        <button type="button" className="dp-head" data-testid="desk-caption-toggle" aria-expanded={capOpen} onClick={onCaption}>
          <span>Caption</span>
          <kbd aria-hidden="true">C</kbd>
        </button>
        {capOpen && (
          <div data-testid="desk-caption">
            {text && (
              <p className="dp-text" data-testid="desk-excerpt" dir={ar ? 'rtl' : 'ltr'} lang={ar ? 'ar' : 'en'} style={ar ? { textAlign: 'right' } : undefined}>
                {text}
              </p>
            )}
            <dl className="vcap-meta" data-testid="desk-meta">
              <div>
                <dt>Speaker</dt>
                <dd>{speaker}</dd>
              </div>
              <div>
                <dt>Episode</dt>
                <dd>{m.videoTitle}</dd>
              </div>
              <div>
                <dt>At</dt>
                <dd>{atTime(m.start)}</dd>
              </div>
              <div>
                <dt>Area</dt>
                <dd style={{ color: AREA_COLOR[m.area] }}>{AREA_LABEL[m.area]}</dd>
              </div>
            </dl>
          </div>
        )}
      </section>

      <section className="dp-sec">
        <div className="dp-head dp-head-static">
          <span>Source</span>
        </div>
        <div data-testid="desk-source">
          {sl ? (
            sl.url ? (
              <a className="dp-source" data-testid="text-source" href={sl.url} target="_blank" rel="noopener noreferrer">
                {`${sl.prefix}${sl.text}`}
              </a>
            ) : (
              <p className="dp-source" data-testid="text-source">{`${sl.prefix}${sl.text}`}</p>
            )
          ) : (
            <p className="dp-source">{`${m.videoTitle}, at ${atTime(m.start)}`}</p>
          )}
        </div>
        <button type="button" className="dp-open" data-testid="desk-open-source" onClick={onSource}>
          <span>Open source</span>
          <kbd aria-hidden="true">O</kbd>
        </button>
      </section>

      {recall && (
        <section className="dp-sec" data-testid="desk-recall">
          {recall}
        </section>
      )}
    </div>
  );
}
