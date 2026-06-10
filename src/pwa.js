// PWA registration (vite-plugin-pwa, registerType: 'autoUpdate').
//
// Why this file exists instead of relying on injectRegister's bare
// registerSW.js: in autoUpdate mode the *virtual* register module wires a
// Workbox `activated` listener that calls window.location.reload() as soon as
// a new service worker takes control. Combined with skipWaiting + clientsClaim
// in the generated SW, this means a fresh deploy reaches the user
// automatically — the page reloads to the new version with NO manual
// hard-refresh. The precached app shell keeps the app fully offline-capable.
import { registerSW } from 'virtual:pwa-register';

// Without an explicit poll the browser only re-checks sw.js on navigation and,
// for a long-lived (installed, never-reloaded) PWA, at most every ~24h. That
// lets a new deploy hang for up to a day. Poll the registration every 15 min so
// updates land fast: r.update() re-fetches sw.js, and on a byte change the
// autoUpdate reload listener swaps the client to the fresh version on its own.
const UPDATE_POLL_MS = 15 * 60 * 1000;

registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    setInterval(() => registration.update(), UPDATE_POLL_MS);
  },
});
