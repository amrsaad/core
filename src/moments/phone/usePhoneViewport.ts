import { useLayoutEffect } from 'react';
import { phoneTopClear } from './flags';
import { iosMajor, makeVpLimiter, phoneTargetHeight, phoneViewportLine } from './viewport';

/**
 * Runde 50: iPhone-App, Feed bis zum unteren Rand und optionaler Abstand unter der Statusleiste (siehe viewport.ts und PHONE_TOP_CLEAR_PX in flags.ts).
 * Setzt am Wurzelelement --ph-h (Zielhöhe, nur im Fehlerfall der Standalone-App, sonst fehlt die Variable) und --ph-clear (Abstand, nur Standalone). Beide erben in den Feed.
 * Schreibt die Zeile "vp: ..." in die Diagnose: beim Start (sobald die Leisten stehen, spätestens nach rund 3 s) und nach resize oder orientationchange, höchstens eine Zeile je 2 s und fünf je Sitzung.
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
    let fix: number | null = null;
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
      const target = phoneTargetHeight({ standalone: sa, portrait: window.innerHeight >= window.innerWidth, screenH: window.screen.height, innerH: window.innerHeight, safeT: st });
      fix = target;
      if (target === null) root.style.removeProperty('--ph-h');
      else root.style.setProperty('--ph-h', `${target}px`);
      root.style.setProperty('--ph-clear', `${sa ? phoneTopClear() : 0}px`);
      return { st, sb, sa };
    };
    const write = () => {
      const { st, sb, sa } = apply();
      log(
        phoneViewportLine({
          iw: window.innerWidth, ih: window.innerHeight, vvh: window.visualViewport?.height, ch: root.clientHeight, sw: window.screen.width, sh: window.screen.height, st, sb,
          standalone: sa, ios, head: rect('.ph-head'), bar: rect('.ph-bar'), feed: rect('.vfeed[data-phone]'), fix,
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
        if (allow(performance.now())) write();
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
      root.style.removeProperty('--ph-h');
      root.style.removeProperty('--ph-clear');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
