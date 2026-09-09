import { defineConfig, devices } from "@playwright/test";
import { requireIsolatedRoots } from "./tests/browser/isolated-roots";

const { releaseRoot: localRoot, assetsRoot, dataRoot } = requireIsolatedRoots(process.env);

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/site-project-acceptance.pw.ts",
  outputDir: "./test-results/playwright-site-project",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4174",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 4174 --strictPort",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
    timeout: 30_000,
    env: { ...process.env, ZUDO_SITE_PROJECT_ROOT: localRoot, ZUDO_ASSETS_STORE_ROOT: assetsRoot, ZUDO_DATA_ROOT: dataRoot },
  },
});
