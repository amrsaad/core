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
/** Weg der alten Zeile nach oben, höchstens (px) */
const OUT_MAX = 60;

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
    // Runde 51b: Höhe vor dem Messen merken (nur um zu erkennen, welche Zeile höher wird)
    for (const e of els.values()) delete e.dataset.snap;
    const oldH = new Map<HTMLElement, number>();
    for (const e of live) oldH.set(e, e.offsetHeight);
    for (const e of live) { e.style.setProperty('--clamp', 'none'); delete e.dataset.cut; }
    const H = b.clientHeight;
    const g = parseFloat(getComputedStyle(b).getPropertyValue('--lyr-gap')) || 12;
    const lh = (e: HTMLElement) => parseFloat(getComputedStyle(e).lineHeight) || 30;
    const nat = (e: HTMLElement) => Math.max(1, Math.round(e.offsetHeight / lh(e)));
    const finalH = new Map<HTMLElement, number>();
    const set = (e: HTMLElement, lines: number, natural: number) => {
      e.style.setProperty('--clamp', lines < natural ? String(lines) : 'none');
      finalH.set(e, lines * lh(e));
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
      // Runde 51b: die alte Zeile fährt höchstens 60 px nach oben (blendet dabei schnell aus), nicht um ihre ganze Höhe
      tops.set(idx - 1, -Math.min(out.offsetHeight + g, OUT_MAX));
    }
    // Runde 51b: wird eine Zeile höher als zuvor, hat sie ab dem ersten Bild ihre Endklemmung. Die Zeilen darunter stehen dann sofort an ihrer Endlage und blenden nur über die Deckkraft ein
    // (aus 0, gleiche Dauer und Kurve), statt durch die wachsende Zeile zu fahren. Ohne Wachstum fährt der Block gemeinsam.
    const snap: HTMLElement[] = [];
    if (!jump) {
      let grew = -1;
      for (let k = 0; k <= NEXT_MAX + 1 && grew < 0; k++) {
        const e = els.get(idx + k);
        if (e && (finalH.get(e) ?? 0) > (oldH.get(e) ?? 0) + 1) grew = k;
      }
      if (grew >= 0) for (let k = grew + 1; k <= NEXT_MAX + 1; k++) { const e = els.get(idx + k); if (e) snap.push(e); }
    }
    for (const e of snap) { e.style.transition = 'none'; e.style.opacity = '0'; e.dataset.snap = ''; }
    for (const [i, t] of tops) els.get(i)!.style.transform = `translate3d(0, ${Math.round(t * 100) / 100}px, 0)`;
    if (jump) {
      void b.offsetHeight;
      delete b.dataset.jump;
    } else if (snap.length) {
      void b.offsetHeight;
      for (const e of snap) { e.style.transition = ''; e.style.opacity = ''; }
      window.setTimeout(() => { for (const e of snap) delete e.dataset.snap; }, 330);
    }
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
