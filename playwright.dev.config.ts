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
  projects: [
    // Desktop is the default lane; a `*.coarse.pw.ts` spec belongs to the
    // coarse project alone, so nothing runs twice.
    { name: "desktop", testIgnore: "**/*.coarse.pw.ts" },
    // Coarse-pointer lane for 44px-target and insert-affordance checks: a
    // touch-capable viewport at the narrowest phone size the chrome supports.
    { name: "coarse", testMatch: "**/*.coarse.pw.ts", use: { hasTouch: true, viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: "corepack pnpm dev",
    url: "http://localhost:5173",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
