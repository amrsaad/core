import { useLayoutEffect, type RefObject } from 'react';
import { PHONE_TEXT_STEPS, phoneFitLine, pickPhoneStep } from '../textfit';

/**
 * Runde 48: Text-Reiter der iPhone-Ansicht, jeder Text auf eine Seite. Ein Messschritt nach dem Layout: die Stufen 0 bis 4 von groß nach klein (data-tfit am Textbereich),
 * die größte, bei der der Inhalt ohne Scrollen passt. Passt keine, bleibt die kleinste und data-tscroll="yes" (Überschrift bleibt oben stehen, siehe phone.css).
 * Das Ergebnis wird je Moment-ID, Breite und Höhe gemerkt: beim Wischen wird nicht neu gemessen. Neu gemessen wird nur, wenn sich die Fläche ändert oder eine Schrift nachkommt.
 */
const memo = new Map<string, { step: number; scroll: boolean }>();

export function usePhoneTextFit(box: RefObject<HTMLElement>, enabled: boolean, id: string | undefined, log: (line: string) => void) {
  useLayoutEffect(() => {
    const el = box.current;
    if (!enabled || !el || !id) return;
    let dead = false;
    let lastLine = '';
    const apply = (r: { step: number; scroll: boolean }) => {
      el.dataset.tfit = String(r.step);
      el.dataset.tscroll = r.scroll ? 'yes' : 'no';
      const line = phoneFitLine(id, r.step, r.scroll);
      if (line !== lastLine) {
        lastLine = line;
        log(line);
      }
    };
    const fit = (force = false) => {
      if (dead) return;
      const key = `${id}|${Math.round(el.clientWidth)}|${Math.round(el.clientHeight)}`;
      const hit = force ? undefined : memo.get(key);
      if (hit) return apply(hit);
      const fits: boolean[] = [];
      // Beim Messen scrollt der Bereich nie von selbst: die Höhe des Inhalts ist scrollHeight
      el.dataset.tscroll = 'no';
      for (let s = 0; s < PHONE_TEXT_STEPS; s++) {
        el.dataset.tfit = String(s);
        const ok = el.scrollHeight <= el.clientHeight + 1;
        fits.push(ok);
        if (ok) break;
      }
      while (fits.length < PHONE_TEXT_STEPS) fits.push(false);
      const r = pickPhoneStep(fits);
      if (memo.size > 300) memo.clear();
      memo.set(key, r);
      apply(r);
    };
    fit();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => fit());
    ro?.observe(el);
    // Schriften kommen nachgeladen: gemerkte Ergebnisse gelten dann nicht mehr
    const refit = () => {
      memo.clear();
      fit(true);
    };
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    fonts?.ready.then(refit).catch(() => {});
    fonts?.addEventListener?.('loadingdone', refit);
    return () => {
      dead = true;
      ro?.disconnect();
      fonts?.removeEventListener?.('loadingdone', refit);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, id]);
}
