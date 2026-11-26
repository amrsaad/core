import type { ReactNode } from 'react';
import { HELP_ROWS } from './desktop';
import { FORM_LABEL, FORMS, type Form } from './form';

/**
 * Bausteine des Desktop-Modus ab 1181 px (Auftrag Max 28.10.2026): Leiste oben mit Reitern, Saved, Settings und Hilfe, Seitenblatt für
 * Settings und Saved, Übersicht der Tasten. Runde 44: Warteschlange, Mitte und rechte Spalte stehen in src/moments/desk.
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

export function DeskBar({ form, setForm, tab, setTab, onHelp }: { form: Form; setForm: (f: Form) => void; tab: DeskTab; setTab: (t: DeskTab) => void; onHelp: () => void }) {
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
