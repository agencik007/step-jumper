// Testy E2E (Playwright): sterowanie dotykiem w prawdziwej przeglądarce, na emulowanym telefonie w poziomie.
// Uruchamia własny serwer deweloperski (window.__game jest tylko w trybie DEV) i nie łączy się z rankingiem online.
//   npm run e2e                 – wszystkie testy
//   npx playwright install      – raz, jeśli na komputerze nie ma jeszcze przeglądarek Playwrighta
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.e2e.ts',                // osobne rozszerzenie, żeby Vitest ich nie podejmował
  timeout: 30_000,
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5174', trace: 'off' },
  webServer: {
    command: 'npx vite --port 5174 --strictPort',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [{ name: 'telefon', use: { ...devices['Pixel 7 landscape'] } }],
});
