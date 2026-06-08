import { defineConfig } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';

// Port resolution: PORT env (CI) → .test-port (local session, see
// port-management) → fixed fallback. Never a well-known port.
const portFile = new URL('./.test-port', import.meta.url);
const PORT = process.env.PORT
  || (existsSync(portFile) ? readFileSync(portFile, 'utf8').trim() : '47811');

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    acceptDownloads: true,
  },
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
