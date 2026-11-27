import { useLayoutEffect } from 'react';
import { phoneTopClear } from './flags';
import { iosMajor, makeVpLimiter, phoneShortWindow, phoneViewportLine } from './viewport';

/**
 * Runde 50: iPhone-App, optionaler Abstand unter der Statusleiste (--ph-clear am Wurzelelement, nur Standalone, siehe viewport.ts und PHONE_TOP_CLEAR_PX in flags.ts).
 * Runde 50c: Rückfall für das zu kurze Fenster (WebKit 301108): data-ph-short am Wurzelelement, solange Standalone, Hochformat und Bildschirmhöhe minus Fensterhöhe gleich der oberen Sicherheitsrand-Höhe ist (phone.css).
 * Schreibt die Zeile "vp: ..." in die Diagnose: beim Start (sobald die Leisten stehen, spätestens nach rund 3 s, bei geänderter Fensterhöhe nach 1,5 s noch einmal) und nach resize oder orientationchange, höchstens eine Zeile je 2 s und fünf je Sitzung.
 */
export function usePhoneViewport(enabled: boolean, log: (line: string) => void) {
  useLayoutEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const root = document.documentElement;
    // Unsichtbares Messelement: Sicherheitsränder (env() auf dem Gerät, im Test die Überschreibung --safe-top und --safe-bottom über --safe-t und --safe-b)
    const probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;box-sizing:content-box;padding:var(--safe-t, env(safe-area-inset-top, 0px)) 0 var(--safe-b, env(safe-area-inset-bottom, 0px)) 0';
    document.body.appendChild(probe);
    const allow = makeVpLimiter();
    const ios = iosMajor(navigator.userAgent || '');
    let dead = false;
    let short = false;
    const standalone = () => (navigator as Navigator & { standalone?: boolean }).standalone === true || !!window.matchMedia?.('(display-mode: standalone)').matches;
    const rect = (sel: string): [number, number] | undefined => {
      const e = document.querySelector(sel);
      if (!e) return undefined;
      const b = e.getBoundingClientRect();
      return [b.top, b.bottom];
    };
    const apply = () => {
      const cs = getComputedStyle(probe);
      const st = parseFloat(cs.paddingTop) || 0;
      const sb = parseFloat(cs.paddingBottom) || 0;
      const sa = standalone();
      short = phoneShortWindow({ standalone: sa, portrait: window.innerHeight >= window.innerWidth, screenH: window.screen.height, innerH: window.innerHeight, safeT: st });
      if (short) root.setAttribute('data-ph-short', '');
      else root.removeAttribute('data-ph-short');
      root.style.setProperty('--ph-clear', `${sa ? phoneTopClear() : 0}px`);
      return { st, sb, sa };
    };
    const topEl = (): string => {
      const e = document.elementFromPoint(window.innerWidth / 2, 2);
      if (!e) return 'none';
      const c = e.classList?.[0];
      return c ? `${e.tagName}.${c}` : e.tagName;
    };
    let firstIh = -1;
    const write = () => {
      const { st, sb, sa } = apply();
      log(
        phoneViewportLine({
          iw: window.innerWidth, ih: window.innerHeight, vvh: window.visualViewport?.height, ch: root.clientHeight, sw: window.screen.width, sh: window.screen.height, st, sb,
          standalone: sa, ios, head: rect('.ph-head'), bar: rect('.ph-bar'), feed: rect('.vfeed[data-phone]'),
          dh: root.scrollHeight, sy: window.scrollY, top: topEl(), short,
        }),
      );
    };
    apply();
    // Start: erst wenn die Leisten stehen (der Feed lädt erst den Pool), sonst nach höchstens 5 Versuchen trotzdem
    let tries = 0;
    let timer = 0;
    const first = () => {
      if (dead) return;
      tries++;
      if ((document.querySelector('.ph-bar') && document.querySelector('.ph-head')) || tries >= 5) {
        if (allow(performance.now())) {
          write();
          // Das Fenster kann sich nach der ersten Zeile noch ändern (iOS vergrößert es, sobald die Seite hoch genug ist): einmal nach 1,5 s nachschreiben, wenn sich ih geändert hat
          firstIh = window.innerHeight;
          timer = window.setTimeout(() => { if (!dead && window.innerHeight !== firstIh && allow(performance.now(), 0)) write(); }, 1500);
        }
        return;
      }
      timer = window.setTimeout(first, 600);
    };
    timer = window.setTimeout(first, 500);
    const onChange = () => {
      if (dead) return;
      apply();
      if (allow(performance.now())) write();
    };
    window.addEventListener('resize', onChange);
    window.addEventListener('orientationchange', onChange);
    window.addEventListener('pageshow', apply);
    return () => {
      dead = true;
      window.clearTimeout(timer);
      window.removeEventListener('resize', onChange);
      window.removeEventListener('orientationchange', onChange);
      window.removeEventListener('pageshow', apply);
      probe.remove();
      root.removeAttribute('data-ph-short');
      root.style.removeProperty('--ph-clear');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
