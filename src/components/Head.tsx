import { useRef } from 'react';
import { FORM_LABEL, FORMS, type Form } from '../moments/form';

type Rate = 1 | 1.5 | 2;

/**
 * Kopfzeile (Entscheidung 22, 41, 50, Brief 06): die drei Reiter als Text mit Linie in der Farbe des aktuellen Bereichs, rechts die Tempo-Pille.
 * Fokus aktiv (Ergänzung zu 39): der gewählte Reiter trägt klein in Reiterfarbe Sprache und Restzeit, die anderen Reiter werden fast unsichtbar.
 * Langes Drücken auf einen Reiternamen öffnet das Fokus-Blatt (onFocusSheet), Antippen des Zusatzes beendet den Fokus (onClearFocus).
 * Die Tempo-Pille nimmt keine Zeiger an. Wische über ihr gehen zur Gesten-Ebene, die den Tipp erkennt (MomentFeed, data-testid=rate).
 */
export function Head({
  form, setForm, rate, onRate, focusText, onClearFocus, onFocusSheet,
}: {
  form: Form;
  setForm: (f: Form) => void;
  rate: Rate;
  onRate: () => void;
  /** Sprache und Restzeit, z. B. "English · 52 min", null ohne Fokus */
  focusText?: string | null;
  onClearFocus?: () => void;
  onFocusSheet?: () => void;
}) {
  const timer = useRef(0);
  const fired = useRef(false);
  const down = () => {
    fired.current = false;
    window.clearTimeout(timer.current);
    if (onFocusSheet) timer.current = window.setTimeout(() => { fired.current = true; onFocusSheet(); }, 500);
  };
  const up = () => window.clearTimeout(timer.current);
  return (
    <div className="head" data-focus={focusText ? 'on' : undefined} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
      <div className="head-tabs" role="radiogroup" aria-label="Form" data-testid="form-switch">
        {FORMS.map((f) => {
          const on = form === f;
          return (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={on}
              className={on ? 'on' : ''}
              onPointerDown={down}
              onPointerUp={up}
              onPointerLeave={up}
              onPointerCancel={up}
              onContextMenu={(e) => e.preventDefault()}
              onClick={() => { if (fired.current) { fired.current = false; return; } setForm(f); }}
            >
              <span className="head-name">{FORM_LABEL[f]}</span>
              {on && focusText && (
                <small
                  className="head-focus"
                  data-testid="focus-in-tab"
                  role="button"
                  tabIndex={0}
                  aria-label={`Focus ${focusText}, tap to end`}
                  onClick={(e) => { e.stopPropagation(); onClearFocus?.(); }}
                >
                  {focusText}
                </small>
              )}
            </button>
          );
        })}
      </div>
      {rate > 1 && form !== 'text' && (
        <button type="button" className="head-rate" data-testid="rate" aria-label={`Speed ${rate}x, tap to change`} onClick={onRate}>
          {rate}x
        </button>
      )}
    </div>
  );
}
