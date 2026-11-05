import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

import { execSync } from 'node:child_process';
import pkg from './package.json';

// Kurzer Commit für die Rückmeldung (GITHUB_SHA in der CI, sonst git, sonst dev)
const commit = (() => {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'dev'; }
})();

// Kanal (Entscheidung 56): Hauptkanal /core/, Vorschau /core/preview/ (CORE_BASE). Der Hauptkanal behält Basis, Name, Icons und Speicher.
// Neu im Hauptkanal ist nur die Ausnahme im Service-Worker für /core/preview/.
const BASE = process.env.CORE_BASE || '/core/';
const PREVIEW = BASE !== '/core/';
const ICON_DIR = PREVIEW ? 'preview/' : '';

export default defineConfig({
  base: BASE,
  build: { outDir: PREVIEW ? 'dist/preview' : 'dist' },
  define: { __APP_VERSION__: JSON.stringify(`${pkg.version}`), __APP_COMMIT__: JSON.stringify(commit) },
  plugins: [
    react(),
    {
      // Vorschau: eigener Name und eigenes Icon auf dem Homescreen, sonst sind beide Installationen nicht zu unterscheiden
      name: 'core-preview-html',
      transformIndexHtml(html: string) {
        if (!PREVIEW) return html;
        return html
          .replace(/(rel="apple-touch-icon" href="[^"]*?)apple-touch-icon\.png"/, `$1${ICON_DIR}apple-touch-icon.png"`)
          .replace('content="core" />', 'content="preview" />')
          .replace('<title>core</title>', '<title>core preview</title>');
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png', ...(PREVIEW ? ['preview/apple-touch-icon.png'] : [])],
      manifest: {
        name: PREVIEW ? 'Core Preview' : 'Core',
        short_name: PREVIEW ? 'preview' : 'core',
        description: 'Geprüftes Wissen statt Scrollen.',
        lang: 'de',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0E0F12',
        theme_color: '#0E0F12',
        icons: [
          { src: `${ICON_DIR}icon-192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${ICON_DIR}icon-512.png`, sizes: '512x512', type: 'image/png' },
          { src: `${ICON_DIR}icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Die markierten Vorschau-Icons gehören nicht in den Vorrat der echten App
        globIgnores: PREVIEW ? [] : ['preview/**'],
        navigateFallback: `${BASE}index.html`,
        // Hauptkanal: der Service-Worker unter /core/ sieht auch Aufrufe von /core/preview/. Ohne Ausnahme lieferte er dort die echte App aus.
        navigateFallbackDenylist: PREVIEW ? [] : [/^\/core\/preview\//],
        runtimeCaching: [
          {
            // index.json zuerst aus dem Netz, damit neue Karten erscheinen
            urlPattern: ({ url }) => url.pathname.endsWith('/cards/index.json'),
            handler: 'NetworkFirst',
            options: { cacheName: 'cards-index', networkTimeoutSeconds: 3 },
          },
          {
            // Momente-Pool (verschlüsselt): frisch aus dem Netz, offline der letzte Stand
            urlPattern: ({ url }) => url.pathname.endsWith('/moments/pool.enc'),
            handler: 'NetworkFirst',
            options: { cacheName: 'moments', networkTimeoutSeconds: 3 },
          },
          {
            // Video-Pool: frisch aus dem Netz, offline der letzte Stand (Videos selbst brauchen Internet)
            urlPattern: ({ url }) => url.pathname.endsWith('/videos/pool.json'),
            handler: 'NetworkFirst',
            options: { cacheName: 'video-pool', networkTimeoutSeconds: 3 },
          },
          {
            urlPattern: ({ url }) => url.hostname === 'i.ytimg.com',
            handler: 'CacheFirst',
            options: { cacheName: 'thumbs', expiration: { maxEntries: 300, maxAgeSeconds: 30 * 86400 } },
          },
          {
            // Tagesdateien ändern sich nach dem Commit nicht mehr
            urlPattern: ({ url }) => url.pathname.includes('/cards/') && url.pathname.endsWith('.json'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'cards', expiration: { maxEntries: 400 } },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: { cacheName: 'fonts', expiration: { maxEntries: 20 } },
          },
        ],
      },
    }),
  ],
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as never);
