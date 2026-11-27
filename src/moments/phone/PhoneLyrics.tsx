import { memo, useLayoutEffect, useRef } from 'react';
import { isArabic } from '../types';

/**
 * Runde 50: mitlaufender Text der iPhone-Ansicht als durchgehende Liste.
 * Befund vorher (Ziel 9): bei jedem Zeilenwechsel wurden drei Elemente mit neuem Schlüssel ersetzt (key = Text), jedes blendete in 120 ms ein (Animation von opacity), die Schriftgröße sprang (17, 24 und 15 px,
 * dazu line-clamp je Rolle): die neue aktuelle Zeile erschien hart an ihrem Platz, die alte verschwand. Dazu rendert bei jedem Wechsel der ganze Feed (setCaption), die Karte selbst war nicht abgegrenzt.
 * Jetzt: eine Zeile je Cue mit festem Schlüssel (Cue-Nummer), Fenster von zwei Zeilen davor bis zwei danach. Alle Zeilen haben dieselbe Schrift (Größe, Gewicht, Umbruch), nur Farbe und Deckkraft unterscheiden sich:
 * ein Größenunterschied würde den Umbruch ändern und beim Wechsel springen, scale an einer Zeile mit anderer Breite würde ebenfalls neu umbrechen. Jede Zeile liegt absolut (top 0) und steht über translate3d
 * an ihrem Platz. Bei einem Wechsel gleiten alle Zeilen in 250 ms (transition auf transform, opacity, color, ease-out) an den neuen Platz: die bisher aktuelle Zeile wird zur vorigen, die nächste zur aktuellen.
 * Ein weiterer Wechsel mitten in der Bewegung setzt nur ein neues Ziel, die Transition läuft vom aktuellen Stand weiter. Sprung (Moment, Suchen, mehr als eine Zeile) und Größenänderung: sofort, ohne Bewegung.
 * Gemessen wird einmal je Wechsel (nicht je Bild). Die aktuelle Zeile hat eine feste Oberkante (hinter dem Platz für zwei vorige Zeilen), darum springt sie nicht, wenn die vorige oder nächste Zeile 1 oder 2 Zeilen hat, nur ihre Unterkante wandert mit ihrer Länge.
 * Reicht die Fläche nicht, werden die Nachbarn in dieser Reihenfolge verkürzt: nächste auf 1 Zeile, vorige auf 1 Zeile, nächste weg, vorige weg (nie angeschnitten, Auslassung am Ende der letzten Zeile).
 */
const lineProps = (s: string) => ({ dir: isArabic(s) ? ('rtl' as const) : ('ltr' as const), lang: isArabic(s) ? 'ar' : 'en' });
const STEPS: [number, number][] = [[2, 2], [2, 1], [1, 1], [1, 0], [0, 0]];

export interface PhoneLyricsProps {
  /** Moment-ID (neuer Moment: sofort setzen) */
  id: string;
  cues: readonly [number, string][];
  /** Nummer des aktuellen Cues, kleiner als 0: noch keiner */
  idx: number;
}

function PhoneLyricsView({ id, cues, idx }: PhoneLyricsProps) {
  const body = useRef<HTMLDivElement>(null);
  const last = useRef<{ id: string; idx: number } | null>(null);
  const rows: { i: number; d: number; text: string }[] = [];
  if (idx >= 0) for (let d = -2; d <= 2; d++) {
    const i = idx + d;
    if (i >= 0 && i < cues.length) rows.push({ i, d, text: cues[i][1].trim() });
  }

  const place = (jump: boolean) => {
    const b = body.current;
    if (!b) return;
    const els = new Map<number, HTMLElement>();
    b.querySelectorAll<HTMLElement>('.ph-row').forEach((e) => els.set(Number(e.dataset.i), e));
    const cur = els.get(idx);
    if (!cur) return;
    for (const e of els.values()) { e.style.setProperty('--clamp', '2'); delete e.dataset.cut; }
    const H = b.clientHeight;
    const g = parseFloat(getComputedStyle(b).getPropertyValue('--lyr-gap')) || 12;
    const hc = cur.offsetHeight;
    const P = els.get(idx - 1);
    const N = els.get(idx + 1);
    const lh = (e?: HTMLElement) => (e ? parseFloat(getComputedStyle(e).lineHeight) || 0 : 0);
    const hn2 = N ? N.offsetHeight : 0;
    const lp = lh(P) || lh(cur);
    const ln = lh(N) || lh(cur);
    // Oberkante der aktuellen Zeile: fest, hinter dem Platz für die vorige Zeile (2, 1 oder 0 Zeilen samt Abstand). Sie springt nicht, wenn die vorige oder nächste Zeile 1 oder 2 Zeilen hat.
    // Passt der Block (Platz oben, aktuelle Zeile, nächste Zeile) nicht in die Fläche, werden die Nachbarn verkürzt: nächste auf 1 Zeile, vorige auf 1, nächste weg, vorige weg.
    let pc = 2;
    let nc = 2;
    for (const [a, c] of STEPS) {
      pc = a;
      nc = c;
      const top = a ? a * lp + g : 0;
      const hn = !N || c === 0 ? 0 : c === 2 ? hn2 : Math.min(hn2, ln);
      if (top + hc + (hn ? g + hn : 0) <= H + 0.5) break;
    }
    if (P) { P.style.setProperty('--clamp', String(Math.max(pc, 1))); if (pc === 0) P.dataset.cut = ''; }
    if (N) { N.style.setProperty('--clamp', String(Math.max(nc, 1))); if (nc === 0) N.dataset.cut = ''; }
    const hP = P && pc > 0 ? P.offsetHeight : 0;
    const hN = N && nc > 0 ? N.offsetHeight : 0;
    const curTop = pc ? pc * lp + g : 0;
    const pTop = curTop - g - hP;
    const nTop = curTop + hc + g;
    const tops = new Map<number, number>([[idx, curTop]]);
    if (P) tops.set(idx - 1, pc > 0 ? pTop : curTop - g - P.offsetHeight);
    if (N) tops.set(idx + 1, nTop);
    const P2 = els.get(idx - 2);
    const N2 = els.get(idx + 2);
    if (P2) tops.set(idx - 2, (tops.get(idx - 1) ?? curTop) - g - P2.offsetHeight);
    if (N2) tops.set(idx + 2, (tops.get(idx + 1) ?? nTop) + hN + g);
    if (jump) b.dataset.jump = '';
    for (const [i, t] of tops) els.get(i)!.style.transform = `translate3d(0, ${Math.round(t * 100) / 100}px, 0)`;
    if (jump) {
      void b.offsetHeight;
      delete b.dataset.jump;
    }
  };

  useLayoutEffect(() => {
    const prev = last.current;
    last.current = { id, idx };
    place(!prev || prev.id !== id || Math.abs(prev.idx - idx) !== 1 || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, idx, cues]);

  useLayoutEffect(() => {
    const b = body.current;
    if (!b) return;
    const again = () => place(true);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(again);
    ro?.observe(b);
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    fonts?.addEventListener?.('loadingdone', again);
    return () => {
      ro?.disconnect();
      fonts?.removeEventListener?.('loadingdone', again);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, idx]);

  return (
    <div className="ph-lyr-body ph-list" ref={body}>
      {rows.map((r) => {
        const role = r.d === 0 ? 'cur' : Math.abs(r.d) === 1 ? (r.d < 0 ? 'prev' : 'next') : 'far';
        const tid = role === 'cur' ? 'caption' : role === 'prev' ? 'ph-lyric-prev' : role === 'next' ? 'ph-lyric-next' : undefined;
        return (
          <p key={r.i} className="ph-row" data-i={r.i} data-role={role} data-testid={tid} {...lineProps(r.text)}>
            {role === 'cur' ? <span>{r.text}</span> : r.text}
          </p>
        );
      })}
    </div>
  );
}

export const PhoneLyrics = memo(PhoneLyricsView);
