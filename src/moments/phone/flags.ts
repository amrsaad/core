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
