import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.ts', timeout: 45_000, workers: 1,
  use: { baseURL: 'https://localhost:5173', screenshot: 'only-on-failure', ignoreHTTPSErrors: true },
  webServer: { command: 'npm run dev -- --host 127.0.0.1', url: 'https://localhost:5173', reuseExistingServer: true, ignoreHTTPSErrors: true },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { args: [...(process.platform === 'darwin' ? ['--use-angle=metal'] : []), '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'], launchOptions: { args: [...(process.platform === 'darwin' ? ['--use-angle=metal'] : []), '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } } },
  ],
})
