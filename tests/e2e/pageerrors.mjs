// Gemeinsame Zählung der Seitenfehler für die e2e-Tests.
// WebKit meldet beim Schließen oder Verlassen einer Seite (goto, about:blank, browser.close) manchmal "Cache API operation failed: Context is stopped".
// Das kommt aus WebKit selbst: jeder Aufruf der Cache API in der App (src/lib/vault.ts, src/moments/preloader.ts) fängt Ablehnungen ab, und die Tests
// blockieren den Service-Worker. Es ist kein Fehler der App. Nur genau diese eine Meldung gilt als harmlos, alles andere zählt weiter.
const HARMLESS = /^(?:\w*Error: )?Cache API operation failed: Context is stopped$/;

export const isHarmlessPageError = (text) => HARMLESS.test(String(text).trim());

/** Handler für page.on('pageerror', ...): legt den Fehlertext in list ab, außer er ist die harmlose WebKit-Meldung */
export const onPageError = (list) => (e) => {
  const text = String(e);
  if (!isHarmlessPageError(text)) list.push(text);
};
