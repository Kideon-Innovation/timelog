import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Inline the app's bundled CSS straight into <head> as a <style> block and
// drop the standalone hashed .css asset.
//
// WHY: the app shell used to be one self-contained index.html (CSS in a
// <style> tag), so the markup and its styles always shipped — and cached —
// as a single atomic document. When the CSS was extracted into its own
// content-hashed file, HTML and CSS became independently cacheable. A burst
// of deploys plus the auto-updating service worker / CDN could then hand a
// client a NEW index.html paired with a STALE style.css (or vice-versa) —
// the hero markup with pre-hero styles — which renders as a "broken" page
// (unstyled CTA, oversized icons). Re-inlining the CSS restores the
// atomic-shell guarantee: the styles can never desync from the markup.
//
// The JS entry stays external (the SW precaches it consistently); only the
// render-blocking CSS — the part whose absence visibly wrecks the layout —
// is inlined. Runs post-build so it sees the final hashed asset; deleting it
// from the bundle means it's never written, so vite-plugin-pwa (which scans
// the output dir) won't try to precache a file that no longer exists.
function inlineAppCss() {
  return {
    name: 'timelog-inline-app-css',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return html;
        return html.replace(
          /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+\.css)"[^>]*>/g,
          (tag, href) => {
            const base = href.split('/').pop();
            const key = Object.keys(bundle).find((k) => k.split('/').pop() === base);
            const asset = key && bundle[key];
            if (!asset || asset.type !== 'asset') return tag; // leave untouched if not found
            const css = String(asset.source);
            delete bundle[key]; // don't emit the standalone file
            return `<style>${css}</style>`;
          }
        );
      },
    },
  };
}

// TimeLog ships to GitHub Pages under the /timelog/ subpath. The single
// index.html stays the app; Vite just hashes external assets, rewrites the
// base path, and (via vite-plugin-pwa) generates a Workbox service worker
// that precaches the app shell for offline use AND auto-updates on deploy.
export default defineConfig({
  base: '/timelog/',

  build: {
    // Keep output readable for a tiny app; assets still get content hashes.
    target: 'es2020',
    sourcemap: false,
  },

  plugins: [
    inlineAppCss(),
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
