// PWA registration (vite-plugin-pwa, registerType: 'autoUpdate').
//
// Why this file exists instead of relying on injectRegister's bare
// registerSW.js: in autoUpdate mode the *virtual* register module wires a
// Workbox `activated` listener that calls window.location.reload() as soon as
// a new service worker takes control. Combined with skipWaiting + clientsClaim
// in the generated SW, this means a fresh GitHub Pages deploy reaches the user
// automatically — the page reloads to the new version with NO manual
// hard-refresh. The precached app shell keeps the app fully offline-capable.
import { registerSW } from 'virtual:pwa-register';

registerSW({ immediate: true });
