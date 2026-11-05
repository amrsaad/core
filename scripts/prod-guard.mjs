// Brücke bis Teil B von Brief 21: Der Service-Worker der echten App (Scope /core/) sieht auch Aufrufe von /core/preview/
// und lieferte dort als navigateFallback die echte App aus. Dieses Skript trägt die Ausnahme in die vite.config.ts eines
// Prod-Checkouts ein, falls sie dort noch fehlt. Hat der Hauptbranch die Ausnahme schon (nach Teil B), tut es nichts.
// Aufruf: node scripts/prod-guard.mjs prod/vite.config.ts
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) throw new Error('Pfad zur vite.config.ts fehlt');
const src = readFileSync(file, 'utf8');

if (src.includes('navigateFallbackDenylist')) {
  console.log('prod-guard: Ausnahme für /core/preview/ ist schon enthalten.');
} else {
  const from = "navigateFallback: '/core/index.html',";
  if (!src.includes(from)) {
    console.log('::warning::prod-guard: navigateFallback nicht gefunden, Prod-Config unverändert. Vorschau kann auf Geräten mit alter App die echte App zeigen.');
  } else {
    writeFileSync(file, src.replace(from, `${from}\n        navigateFallbackDenylist: [/^\\/core\\/preview\\//],`));
    console.log('prod-guard: Ausnahme für /core/preview/ in den Prod-Checkout eingetragen.');
  }
}
