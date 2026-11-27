/**
 * Runde 45: iPhone-Ansicht Schritt 1 (feste Abspielleiste unten, Aktionsreihe darüber, Reiterleiste oben).
 * Alles hängt an diesem einen Schalter. false: die App am Handy ist exakt wie vor Runde 45 (kein anderes Markup, keine andere Klasse).
 * Der Umbau gilt nur unter BP_TABLET (Handy). Tablet und Desktop bleiben unberührt.
 *
 * Test-Hook wie ?now= und ?seed=: ?phone=0 schaltet die Ansicht zur Laufzeit aus (wird in sessionStorage gemerkt, ?phone=1 hebt es auf).
 * Der Hook kann nur ausschalten, nie einschalten: ist PHONE_V2 false, bleibt sie aus.
 */
export const PHONE_V2 = true;

/** Umschalter der Laufzeit, "0" aus. Ohne Browser (Tests in Node) nie aus. */
export function phoneOverride(): boolean {
  try {
    const p = new URLSearchParams(location.search).get('phone');
    if (p === '0' || p === '1') sessionStorage.setItem('core-phone', p);
    return sessionStorage.getItem('core-phone') !== '0';
  } catch {
    return true;
  }
}

export const phoneEnabled = (): boolean => PHONE_V2 && phoneOverride();

/**
 * Runde 50: Abstand unter der Statusleiste der installierten App, in px. 0 = aus.
 * Auf iOS 26 legt das System bei black-translucent einen Weichzeichner rund 40 pt unter die Statusleiste. Bleibt die feste Kopfleiste allein nicht scharf,
 * genügt hier ein Einzeiler (40): die Reiterleiste und alles darunter rückt um diesen Wert nach unten, die Fläche dazwischen hat die Farbe der Bühne.
 * Gilt nur in der installierten App (usePhoneViewport setzt --ph-clear), nie im Browser-Tab. Test: window.__phTopClear (Zahl, vor dem Laden gesetzt) überschreibt den Wert.
 */
export const PHONE_TOP_CLEAR_PX = 0;

export function phoneTopClear(): number {
  const o = typeof window === 'undefined' ? undefined : (window as unknown as { __phTopClear?: unknown }).__phTopClear;
  return typeof o === 'number' && o >= 0 && o <= 80 ? o : PHONE_TOP_CLEAR_PX;
}
