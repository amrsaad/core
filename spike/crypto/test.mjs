// T4-Test: Entschlüsseln in WebKit (iPhone 15), Schlüssel überlebt Neuladen ohne Fragment.
// Aufruf: node spike/crypto/test.mjs <url-zu-index.html> <schluessel-datei> [browser=webkit]
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium, devices, webkit } from 'playwright';

const [url, keyFile, which = 'webkit'] = process.argv.slice(2);
const key = readFileSync(keyFile, 'utf8').trim();
const browser = await (which === 'chromium' ? chromium : webkit).launch();
const ctx = await browser.newContext({ ...devices['iPhone 15'] });
const page = await ctx.newPage();
const res = { browser: which };
await page.goto(`${url}#k=${key}`);
await page.waitForFunction(() => window.__result, null, { timeout: 15000 });
res.first = await page.evaluate(() => ({ ...window.__result, data: !!window.__result.data }));
res.urlAfterFirst = page.url().includes('#') ? 'Fragment noch da' : 'Fragment entfernt';
await page.screenshot({ path: `spike/crypto/t4-${which}-1.png` });
await page.goto(url);
await page.waitForFunction(() => window.__result, null, { timeout: 15000 });
res.afterReload = await page.evaluate(() => ({ ...window.__result, data: !!window.__result.data }));
await page.screenshot({ path: `spike/crypto/t4-${which}-2-neu-geladen.png` });
// Falscher Schlüssel muss scheitern
const ctx2 = await browser.newContext({ ...devices['iPhone 15'] });
const p2 = await ctx2.newPage();
await p2.goto(`${url}#k=${Buffer.alloc(32, 7).toString('base64url')}`);
await p2.waitForFunction(() => window.__result, null, { timeout: 15000 });
res.wrongKey = await p2.evaluate(() => window.__result.ok);
res.passed = res.first.ok && res.afterReload.ok && res.urlAfterFirst === 'Fragment entfernt' && res.wrongKey === false;
await browser.close();
writeFileSync(`spike/crypto/t4-result-${which}.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res));
