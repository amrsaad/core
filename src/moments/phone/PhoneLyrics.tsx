import { memo, useLayoutEffect, useRef } from 'react';
import { isArabic } from '../types';

/**
 * Runde 51e: mitlaufender Text der iPhone-Ansicht als starre Spalte (wie bei Songtexten).
 * Alle Zeilen stehen in EINER Spalte im normalen Fluss untereinander, jede Zeile hat immer dieselbe Höhe (eine Klemmung K für alle: die größte Zeilenzahl, die in die Fläche passt, mindestens 2),
 * dieselbe Schrift und denselben Abstand, egal ob vorige, aktuelle oder folgende Zeile. K steht als --clamp am Feld und ändert sich nur, wenn sich die Fläche ändert, nie bei einem Zeilenwechsel.
 * Die aktuelle Zeile steht am Anker (Oberkante der Fläche): ein einziges translateY an der Spalte (minus offsetTop der aktuellen Zeile). Ein Zeilenwechsel ändert nur diesen Wert und die Rolle (data-role) der Zeilen,
 * kein Layout ändert sich. Bewegung: nur transform an der Spalte (250 ms bis 120 px Weg, darüber Weg mal 2,2 ms, höchstens 420 ms), Deckkraft je Zeile in CSS. Ein Wechsel mitten in der Bewegung setzt nur ein neues Ziel
 * (die Transition läuft vom aktuellen Stand weiter). Weiter als das 1,5-fache der Fläche: nicht fahren, Spalte in 80 ms aus, ohne Transition umsetzen, in 160 ms ein.
 */
const lineProps = (s: string) => ({ dir: isArabic(s) ? ('rtl' as const) : ('ltr' as const), lang: isArabic(s) ? 'ar' : 'en' });
/** Weg (px), bis zu dem die Bewegung 250 ms dauert */
const NEAR_PX = 120;
const DUR_MIN = 250;
const DUR_MAX = 420;

export interface PhoneLyricsProps {
  /** Moment-ID (neuer Moment: neuer Aufbau, die Ansicht wird je Moment neu eingehängt) */
  id: string;
  cues: readonly [number, string][];
  /** Nummer des aktuellen Cues, kleiner als 0: noch keiner */
  idx: number;
}

function PhoneLyricsView({ id, cues, idx }: PhoneLyricsProps) {
  const body = useRef<HTMLDivElement>(null);
  const col = useRef<HTMLDivElement>(null);
  const want = useRef(0);
  const jump = useRef<{ out?: Animation; inn?: Animation; tok: number }>({ tok: 0 });
  const seenCues = useRef<unknown>(null);

  /** Klemmung K: größte Zeilenzahl, die in die Fläche passt (mindestens 2), mit der größten Zeilenhöhe der Zeilen (arabisch höher) */
  const fit = () => {
    const b = body.current;
    const c = col.current;
    if (!b || !c) return;
    const lh = (e: Element | null) => (e ? parseFloat(getComputedStyle(e).lineHeight) || 0 : 0);
    const l = Math.max(lh(c.firstElementChild), lh(c.querySelector('[lang=ar]'))) || 30;
    c.style.setProperty('--clamp', String(Math.max(2, Math.floor(b.clientHeight / l))));
  };

  const place = (instant: boolean) => {
    const b = body.current;
    const c = col.current;
    const cur = c?.children[idx] as HTMLElement | undefined;
    if (!b || !c || !cur) return;
    const y = -Math.round(cur.offsetTop * 100) / 100;
    const m = getComputedStyle(c).transform;
    const now = m && m !== 'none' ? new DOMMatrixReadOnly(m).m42 : 0;
    const dist = Math.abs(y - now);
    const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const j = jump.current;
    j.tok++;
    j.out?.cancel();
    j.inn?.cancel();
    want.current = y;
    const set = (ms: number) => {
      c.style.transitionDuration = `${ms}ms`;
      c.style.transform = `translate3d(0, ${want.current}px, 0)`;
    };
    if (instant || reduced || dist < 0.5) {
      set(0);
    } else if (dist > 1.5 * b.clientHeight && typeof c.animate === 'function') {
      const tok = j.tok;
      j.out = c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 80, fill: 'forwards' });
      j.out.finished
        .then(() => {
          if (tok !== jump.current.tok) return;
          set(0);
          jump.current.inn = c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
          jump.current.out?.cancel();
        })
        .catch(() => {});
    } else {
      set(Math.min(DUR_MAX, Math.max(DUR_MIN, dist > NEAR_PX ? dist * 2.2 : DUR_MIN)));
    }
  };
  const placeRef = useRef(place);
  placeRef.current = place;
  const fitRef = useRef(fit);
  fitRef.current = fit;

  // Fläche: K neu und sofort setzen, nur bei echter Größenänderung oder wenn Schriften nachgeladen sind (ein ResizeObserver je Moment)
  useLayoutEffect(() => {
    const b = body.current;
    if (!b) return;
    let w = b.clientWidth;
    let h = b.clientHeight;
    const again = () => {
      fitRef.current();
      placeRef.current(true);
    };
    const ro = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          if (b.clientWidth === w && b.clientHeight === h) return;
          w = b.clientWidth;
          h = b.clientHeight;
          again();
        });
    ro?.observe(b);
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    fonts?.addEventListener?.('loadingdone', again);
    return () => {
      ro?.disconnect();
      fonts?.removeEventListener?.('loadingdone', again);
    };
  }, [id]);

  const had = useRef(false);
  useLayoutEffect(() => {
    // Spalte neu im DOM (erste Zeile, erster Aufbau): sofort setzen. K nur neu, wenn die Zeilen andere sind (nie bei einem Zeilenwechsel).
    const now = !!col.current;
    if (now && (!had.current || seenCues.current !== cues)) fit();
    seenCues.current = cues;
    place(!had.current);
    had.current = now;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, idx, cues]);

  if (idx < 0) return <div className="ph-lyr-body ph-list" ref={body} />;
  return (
    <div className="ph-lyr-body ph-list" ref={body}>
      <div className="ph-col" ref={col}>
        {cues.map((q, i) => {
          const d = i - idx;
          const role = d === 0 ? 'cur' : d === 1 ? 'next' : d > 1 ? 'later' : d === -1 ? 'out' : 'past';
          const tid = role === 'cur' ? 'caption' : role === 'next' ? 'ph-lyric-next' : role === 'out' ? 'ph-lyric-out' : undefined;
          const text = q[1].trim();
          return (
            <p key={i} className="ph-row" data-i={i} data-role={role} data-testid={tid} {...lineProps(text)}>
              {role === 'cur' ? <span>{text}</span> : text}
            </p>
          );
        })}
      </div>
    </div>
  );
}

export const PhoneLyrics = memo(PhoneLyricsView);
