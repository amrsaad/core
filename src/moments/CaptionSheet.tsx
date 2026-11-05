import { useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { askUrl } from './ask';
import { AREA_COLOR, AREA_LABEL } from '../lib/labels';
import { atTime, closesCaption } from './hook';
import { momentText } from './form';
import { isArabic, type Moment } from './types';

/** Kontext zur Stelle (zwei Sätze), klein und gedämpft unter dem Ausschnitt. Fehlt das Feld oder ist es leer, wird nichts gezeigt. */
export function ContextLine({ text, testid }: { text?: string; testid: string }) {
  const t = text?.trim();
  if (!t) return null;
  const ar = isArabic(t);
  return (
    <div className="vcap-context" data-testid={testid}>
      <span className="vcap-ctx-label">Context</span>
      <p className="vcap-ctx-text" dir={ar ? 'rtl' : 'ltr'} lang={ar ? 'ar' : 'en'} style={ar ? { textAlign: 'right' } : undefined}>{t}</p>
    </div>
  );
}

/**
 * Aufgeklappte Caption wie bei Instagram: oben der Hook, darunter der excerpt als Lesetext (Arabisch rechtsläufig),
 * darunter der Kontext (falls vorhanden), dann Sprecher, Folge, Stelle. Das Video läuft darüber weiter, nichts wird pausiert.
 * Zu: Tipp außerhalb oder Wischen nach unten.
 */
export function CaptionSheet({ m, speaker, onClose }: { m: Moment; speaker: string; onClose: () => void }) {
  const y = useRef(0);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const t = momentText(m);
  const ar = isArabic(t);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <>
      <div className="vcap-backdrop" data-testid="caption-backdrop" onPointerDown={stop} onPointerUp={(e) => { e.stopPropagation(); onClose(); }} onClick={stop} />
      <div
        ref={box}
        className="vcap-sheet no-callout"
        data-testid="caption-sheet"
        style={{ ['--area' as string]: AREA_COLOR[m.area] }}
        onPointerDown={stop}
        onPointerUp={stop}
        onTouchStart={(e) => (y.current = e.touches[0].clientY)}
        onTouchEnd={(e) => {
          if (closesCaption(e.changedTouches[0].clientY - y.current, box.current?.scrollTop ?? 0)) onClose();
        }}
      >
        {/* Griffleiste mit Schließen-Knopf oben rechts (Brief 17, Issue 39). Bleibt beim Scrollen oben stehen. Bleibt das erste Kind, die Reihenfolge ist getestet. */}
        <div className="vcap-bar">
          <div className="vcap-grip" aria-hidden="true" />
          <button type="button" className="vcap-x" data-testid="caption-close" aria-label="Close" onClick={onClose}>
            <Icon name="x" size="var(--icon)" />
          </button>
        </div>
        <h2 className="vcap-hook" data-testid="caption-hook">{m.hook}</h2>
        {t && (
          <p className="vcap-text" data-testid="caption-excerpt" dir={ar ? 'rtl' : 'ltr'} lang={ar ? 'ar' : 'en'} style={ar ? { textAlign: 'right' } : undefined}>{t}</p>
        )}
        <ContextLine text={m.context} testid="caption-context" />
        <dl className="vcap-meta" data-testid="caption-meta">
          <div><dt>Speaker</dt><dd>{speaker}</dd></div>
          <div><dt>Episode</dt><dd>{m.videoTitle}</dd></div>
          <div><dt>At</dt><dd>{atTime(m.start)}</dd></div>
          <div><dt>Area</dt><dd style={{ color: AREA_COLOR[m.area] }}>{AREA_LABEL[m.area]}</dd></div>
        </dl>
        {/* Ask: öffnet Claude mit dem Moment und der getippten Frage (Entscheidung 18, kein Chat in der App) */}
        <form
          className="vcap-ask"
          data-testid="caption-ask"
          onSubmit={(e) => {
            e.preventDefault();
            if (!q.trim()) return;
            window.open(`${askUrl(m)}${encodeURIComponent(q.trim())}`, '_blank', 'noopener');
          }}
        >
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about this moment" aria-label="Ask about this moment" maxLength={300} />
          <button type="submit" className="vcap-send" aria-label="Send question" disabled={!q.trim()}><Icon name="arrow-up" size="var(--icon)" /></button>
        </form>
        {/* Later (Entscheidung 49): Platzhalter ohne Funktion, die Karte im Feed kommt nach Brief 06 */}
        <button type="button" className="vcap-later" data-testid="caption-later" disabled aria-disabled="true"><Icon name="clock" size="var(--icon-sm)" />Later</button>
      </div>
    </>
  );
}
