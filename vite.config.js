import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// TimeLog ships to GitHub Pages, but is reachable both at the custom-domain
// root (https://timelog.kideon.de/) AND under the project /timelog/ subpath.
// A relative base ('./') makes every hashed asset URL resolve against the
// document URL — exactly like the relative icon/manifest hrefs — so the app
// works at either location. An absolute '/timelog/' base hard-codes the
// subpath and 404s every asset on the custom domain.
// The single index.html stays the app; Vite just hashes external assets,
// rewrites to the relative base, and (via vite-plugin-pwa) generates a Workbox
// service worker that precaches the app shell for offline use AND auto-updates
// on deploy.
export default defineConfig({
  base: './',

  build: {
    // Keep output readable for a tiny app; assets still get content hashes.
    target: 'es2020',
    sourcemap: false,
  },

  plugins: [
    VitePWA({
      // autoUpdate + skipWaiting/clientsClaim (below) => a new deploy installs,
      // takes control immediately and the client reloads to the fresh version
      // with no manual hard-refresh. This is THE reloading fix.
      registerType: 'autoUpdate',
      // Inject the SW registration for us; the app also imports the virtual
      // register module (see index.html) so we don't hand-roll registration.
      injectRegister: 'auto',

      // Reuse the existing installable-PWA metadata (was manifest.webmanifest)
      // so installability/icons/theme/offline are preserved 1:1.
      manifest: {
        name: 'TimeLog — Zeiterfassung für Kanzleien',
        short_name: 'TimeLog',
        description:
          'Zeiterfassung für Kanzleien. TimeLog fragt dich in festem Takt, woran du arbeitest, und baut deinen Stundenzettel als Blöcke auf. DSGVO-konform, weil alles lokal im Browser bleibt: kein Server, kein Login, voll offline. Export als Excel.',
        lang: 'de',
        dir: 'ltr',
        start_url: './',
        scope: './',
        id: './',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
        orientation: 'any',
        background_color: '#faf9f7',
        theme_color: '#faf9f7',
        categories: ['productivity', 'utilities'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          {
            name: 'Jetzt eintragen',
            short_name: 'Eintragen',
            description: 'Aktuellen Zeitblock sofort beschriften',
            url: './?action=log',
            icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }],
          },
          {
            name: 'Excel-Export',
            short_name: 'Export',
            description: 'Zeiterfassung als .xlsx exportieren',
            url: './?action=export',
            icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }],
          },
        ],
        screenshots: [
          { src: 'screenshots/desktop-dark.png', sizes: '1440x900', type: 'image/png', form_factor: 'wide', label: '3-Tage-Kalender mit Live-Blöcken' },
          { src: 'screenshots/desktop-ping.png', sizes: '1440x900', type: 'image/png', form_factor: 'wide', label: 'Ping — woran arbeitest du gerade?' },
          { src: 'screenshots/mobile-dark.png', sizes: '414x896', type: 'image/png', form_factor: 'narrow', label: 'Mobile Tagesansicht' },
          { src: 'screenshots/mobile-ping.png', sizes: '414x896', type: 'image/png', form_factor: 'narrow', label: 'Ping auf dem Handy' },
        ],
      },

      // Static assets in public/ that must be precached for offline (icons
      // referenced by the manifest, the SVG favicon, install screenshots).
      includeAssets: ['icons/**/*'],

      workbox: {
        // Precache the built app shell (HTML + hashed JS/CSS + icons) so the
        // app boots fully offline — preserves the old sw.js offline behavior.
        globPatterns: ['**/*.{html,js,css,png,svg,ico,webmanifest}'],
        // xlsx vendor bundle is ~930KB; raise the cap so it's precached too.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // Take over immediately on update => no waiting SW, client reloads to new.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // SPA-style navigation fallback to the precached shell (works offline).
        navigateFallback: 'index.html',
        // Runtime-cache Google Fonts so first-paint typography survives offline.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },

      devOptions: {
        // Let `vite dev` exercise the SW too (handy for local checks).
        enabled: false,
      },
    }),
  ],
});
