import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser-dev",
  testMatch: "**/*.pw.ts",
  outputDir: "./test-results/playwright-dev",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "corepack pnpm dev",
    url: "http://localhost:5173",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
