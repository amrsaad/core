import { useRef } from 'react';
import { AREA_COLOR, AREA_LABEL } from '../lib/labels';
import { atTime, closesCaption } from './hook';
import { momentText } from './form';
import { isArabic, type Moment } from './types';

/**
 * Aufgeklappte Caption wie bei Instagram: oben der Hook, darunter der excerpt als Lesetext (Arabisch rechtsläufig),
 * darunter Sprecher, Folge, Stelle. Das Video läuft darüber weiter, nichts wird pausiert.
 * Zu: Tipp außerhalb oder Wischen nach unten.
 */
export function CaptionSheet({ m, speaker, onClose }: { m: Moment; speaker: string; onClose: () => void }) {
  const y = useRef(0);
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
        <div className="vcap-grip" aria-hidden="true" />
        <h2 className="vcap-hook" data-testid="caption-hook">{m.hook}</h2>
        {t && (
          <p className="vcap-text" data-testid="caption-excerpt" dir={ar ? 'rtl' : 'ltr'} lang={ar ? 'ar' : 'en'} style={ar ? { textAlign: 'right' } : undefined}>{t}</p>
        )}
        <dl className="vcap-meta" data-testid="caption-meta">
          <div><dt>Speaker</dt><dd>{speaker}</dd></div>
          <div><dt>Episode</dt><dd>{m.videoTitle}</dd></div>
          <div><dt>At</dt><dd>{atTime(m.start)}</dd></div>
          <div><dt>Area</dt><dd style={{ color: AREA_COLOR[m.area] }}>{AREA_LABEL[m.area]}</dd></div>
        </dl>
      </div>
    </>
  );
}
