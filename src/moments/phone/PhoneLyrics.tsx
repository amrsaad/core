import { memo, useLayoutEffect, useRef } from 'react';
import { isArabic } from '../types';

/**
 * Runde 50b: mitlaufender Text der iPhone-Ansicht als durchgehende Liste, die aktuelle Zeile steht OBEN.
 * Aufbau: Titelbild (falls da), darunter direkt die aktuelle Zeile (feste Oberkante: ändert sich bei keinem Zeilenwechsel, hängt nur davon ab, ob ein Titelbild da ist), darunter die nächsten Zeilen,
 * so viele wie vollständig passen, höchstens drei, jede auf höchstens 2 Zeilen geklemmt (Auslassung, Höhe immer ein ganzes Vielfaches der Zeilenhöhe). Die vorige Zeile bleibt nicht stehen:
 * beim Wechsel gleitet die alte aktuelle Zeile nach oben weg und blendet aus, die nächste rückt an den Anker und wird hell, unten rückt eine neue nach.
 * Alle Zeilen haben dieselbe Schrift (der Umbruch ändert sich nie), nur Farbe und Deckkraft unterscheiden die Rollen. Jede Zeile liegt absolut (top 0) und steht über translate3d an ihrem Platz.
 * Bewegung: nur transform, opacity, color (250 ms, --ease). Ein weiterer Wechsel mitten in der Bewegung setzt nur ein neues Ziel. Sprung (Moment, Suchen, mehr als eine Zeile) und echte Größenänderung: sofort.
 * Gemessen wird einmal je Wechsel (nicht je Bild). Der ResizeObserver lebt einmal je Moment und ruft nur bei echter Größenänderung (nie aus dem ersten Aufruf nach observe): sonst bräche er die gerade
 * gestartete Bewegung ab (Befund Runde 50b: Dauer 33 ms, erster Schritt 216 px).
 * Platzmangel, Reihenfolge der Opfer (hier die letzten drei): nächste Zeilen weniger, zuletzt die aktuelle Zeile auf die verfügbare ganze Zeilenzahl klemmen (mit Auslassung), nie außerhalb der Karte.
 */
const lineProps = (s: string) => ({ dir: isArabic(s) ? ('rtl' as const) : ('ltr' as const), lang: isArabic(s) ? 'ar' : 'en' });
/** Deckkraft der nächsten Zeilen nach unten (die direkt nächste Zeile bleibt bei 1, siehe phone.css) */
const NEXT_MAX = 3;

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
  const grow = useRef(0);
  const rows: { i: number; d: number; text: string }[] = [];
  if (idx >= 0) for (let d = -1; d <= NEXT_MAX + 1; d++) {
    const i = idx + d;
    if (i >= 0 && i < cues.length) rows.push({ i, d, text: cues[i][1].trim() });
  }

  const place = (jump: boolean) => {
    const b = body.current;
    if (!b) return;
    // Bei einem Sprung zuerst die Übergänge aus, noch vor dem ersten Lesen (das Lesen löst die Stilberechnung aus)
    if (jump) b.dataset.jump = '';
    const els = new Map<number, HTMLElement>();
    b.querySelectorAll<HTMLElement>('.ph-row').forEach((e) => els.set(Number(e.dataset.i), e));
    const cur = els.get(idx);
    if (!cur) {
      delete b.dataset.jump;
      return;
    }
    const live = [0, 1, 2, 3, 4].map((k) => els.get(idx + k)).filter((e): e is HTMLElement => !!e);
    // Runde 51: Höhe und Klemmung vor dem Messen merken. Eine Zeile, die höher wird, bekommt die neue Klemmung erst am Ende der Bewegung (sonst überlappt sie die Zeile darunter, die noch ihren alten Weg fährt), eine kleinere sofort.
    const oldH = new Map<HTMLElement, number>();
    const oldClamp = new Map<HTMLElement, string>();
    for (const e of live) { oldH.set(e, e.offsetHeight); oldClamp.set(e, e.style.getPropertyValue('--clamp')); }
    if (grow.current) { window.clearTimeout(grow.current); grow.current = 0; }
    const later: [HTMLElement, string][] = [];
    for (const e of live) { e.style.setProperty('--clamp', 'none'); delete e.dataset.cut; }
    const H = b.clientHeight;
    const g = parseFloat(getComputedStyle(b).getPropertyValue('--lyr-gap')) || 12;
    const lh = (e: HTMLElement) => parseFloat(getComputedStyle(e).lineHeight) || 30;
    const nat = (e: HTMLElement) => Math.max(1, Math.round(e.offsetHeight / lh(e)));
    const set = (e: HTMLElement, lines: number, natural: number) => {
      const v = lines < natural ? String(lines) : 'none';
      if (!jump && lines * lh(e) > (oldH.get(e) ?? 0) + 0.5 && oldH.get(e)) {
        later.push([e, v]);
        e.style.setProperty('--clamp', oldClamp.get(e) || '2');
      } else e.style.setProperty('--clamp', v);
    };
    // Aktuelle Zeile: ganz, höchstens so viele ganze Zeilen, wie in die Fläche passen (dann mit Auslassung)
    const lc = lh(cur);
    const nc = nat(cur);
    const lines = Math.max(1, Math.min(nc, Math.floor((H + 0.5) / lc)));
    set(cur, lines, nc);
    const hc = lines * lc;
    const tops = new Map<number, number>([[idx, 0]]);
    // Nächste Zeilen: so viele wie vollständig passen (je höchstens 2 Zeilen, sonst 1 Zeile), höchstens drei
    let y = hc + g;
    let open = true;
    for (let k = 1; k <= NEXT_MAX + 1; k++) {
      const e = els.get(idx + k);
      if (!e) break;
      const l = lh(e);
      const n = nat(e);
      let shown = 0;
      if (open && k <= NEXT_MAX) for (const want of [Math.min(n, 2), 1]) if (!shown && y + want * l <= H + 0.5) shown = want;
      if (shown) {
        set(e, shown, n);
        tops.set(idx + k, y);
        y += shown * l + g;
      } else {
        open = false;
        e.style.setProperty('--clamp', '2');
        e.dataset.cut = '';
        tops.set(idx + k, y);
        // Runde 51: nicht gezeigte Zeilen stehen weiter unten im Stapel (unter der letzten gezeigten Zeile), nicht auf deren Platz: so fährt der ganze Block mit gleichem Versatz, nichts überlappt beim Einrücken
        y += Math.min(n, 2) * l + g;
      }
    }
    // Alte aktuelle Zeile: über den Anker hinaus nach oben, ausgeblendet (behält ihre letzte Klemmung)
    const out = els.get(idx - 1);
    if (out) {
      out.dataset.cut = '';
      tops.set(idx - 1, -(out.offsetHeight + g));
    }
    for (const [i, t] of tops) els.get(i)!.style.transform = `translate3d(0, ${Math.round(t * 100) / 100}px, 0)`;
    if (jump) {
      void b.offsetHeight;
      delete b.dataset.jump;
    }
    if (later.length) grow.current = window.setTimeout(() => { grow.current = 0; for (const [e, v] of later) e.style.setProperty('--clamp', v); }, 280);
  };
  const placeRef = useRef(place);
  placeRef.current = place;

  useLayoutEffect(() => {
    const prev = last.current;
    last.current = { id, idx };
    place(!prev || prev.id !== id || Math.abs(prev.idx - idx) !== 1 || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, idx, cues]);

  // Einmal je Moment (nicht je Zeile): neues Beobachten feuert sofort und bräche die Bewegung ab. Nur eine echte Größenänderung setzt neu (sofort).
  useLayoutEffect(() => () => window.clearTimeout(grow.current), []);
  useLayoutEffect(() => {
    const b = body.current;
    if (!b) return;
    let w = b.clientWidth;
    let h = b.clientHeight;
    const again = () => placeRef.current(true);
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

  return (
    <div className="ph-lyr-body ph-list" ref={body}>
      {rows.map((r) => {
        const role = r.d === 0 ? 'cur' : r.d < 0 ? 'out' : r.d <= NEXT_MAX ? (`next${r.d === 1 ? '' : r.d}` as const) : 'far';
        const tid = role === 'cur' ? 'caption' : role === 'next' ? 'ph-lyric-next' : role === 'out' ? 'ph-lyric-out' : undefined;
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
