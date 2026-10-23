import { defineConfig, devices } from '@playwright/test';
const port = Number(process.env.ANIMATOR_TEST_PORT ?? 4501);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid ANIMATOR_TEST_PORT.');
export default defineConfig({
  testDir: './tests/browser', fullyParallel: true, workers: 2, reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${port}`, trace: { mode: 'retain-on-failure', screenshots: false }, screenshot: 'only-on-failure' },
  webServer: { command: `npm run preview -- --port ${port} --strictPort`, url: `http://127.0.0.1:${port}`, reuseExistingServer: false },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
