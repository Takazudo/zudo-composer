import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.HOSTED_DEMO_BASE_URL?.trim() || "http://127.0.0.1:4175";

export default defineConfig({
  testDir: "./tests/browser-hosted",
  testMatch: "**/*.pw.ts",
  outputDir: "./test-results/playwright-hosted-demo",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
});
