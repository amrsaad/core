// Einmalig: rendert public/icon.svg nach PNG 180/192/512. Nutzt ein vorhandenes Playwright (keine Projekt-Abhängigkeit).
// Aufruf: npm run icons  (sucht Playwright global)
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(`${execSync('npm root -g').toString().trim()}/`);
const { chromium } = require('playwright');

const svg = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
for (const [size, name] of [[180, 'apple-touch-icon.png'], [192, 'icon-192.png'], [512, 'icon-512.png']]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: new URL(`../public/${name}`, import.meta.url).pathname });
  await page.close();
}
await browser.close();
console.log('Icons geschrieben');
