import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.DEMO_EDITOR_BASE_URL?.trim() || "http://127.0.0.1:4175";
const name = process.env.DEMO_EDITOR_NAME?.trim() || "unknown";

export default defineConfig({
  testDir: "./tests/browser-hosted",
  testMatch: "**/*.pw.ts",
  outputDir: `./test-results/playwright-demo-editor/${name}`,
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
