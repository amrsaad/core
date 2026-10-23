import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

import pkg from './package.json';

export default defineConfig({
  base: '/core/',
  define: { __APP_VERSION__: JSON.stringify(`${pkg.version}`) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Core',
        short_name: 'core',
        description: 'Geprüftes Wissen statt Scrollen.',
        lang: 'de',
        start_url: '/core/',
        scope: '/core/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0E0F12',
        theme_color: '#0E0F12',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/core/index.html',
        runtimeCaching: [
          {
            // index.json zuerst aus dem Netz, damit neue Karten erscheinen
            urlPattern: ({ url }) => url.pathname.endsWith('/cards/index.json'),
            handler: 'NetworkFirst',
            options: { cacheName: 'cards-index', networkTimeoutSeconds: 3 },
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
