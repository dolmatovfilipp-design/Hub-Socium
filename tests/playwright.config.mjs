import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export default defineConfig({
  testDir: '.',
  testMatch: 'circle-voice.webkit.spec.mjs',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    ...devices['Desktop Safari'],
    viewport: { width: 390, height: 844 },
    baseURL: 'http://127.0.0.1:5174',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5174 --strictPort',
    cwd: root,
    url: 'http://127.0.0.1:5174/tests/circle-voice.html',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
