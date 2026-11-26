// Runde 45: in der neuen Handy-Ansicht gibt es im Feed keine untere Navigation mehr. Settings öffnet die Taste "Today N" oben rechts, Saved und Feed liegen
// danach in der Navigation des Settings-Reiters. Dieser Helfer klickt die Navigation wie bisher und geht, falls sie fehlt (nur Feed, nur neue Ansicht), erst über die Taste oben.
export async function navTo(page, label) {
  const sel = `nav [aria-label=${label}]`;
  if ((await page.locator(sel).count()) === 0 && (await page.locator('[data-testid=today]').count()) > 0) {
    await page.click('[data-testid=today]');
    await page.waitForSelector('nav [aria-label=Feed]');
    if (label === 'Settings') return;
  }
  await page.click(sel);
}
