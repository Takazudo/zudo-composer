import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.pw.ts",
  outputDir: "./test-results/playwright",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  projects: [
    // Two lanes chosen by filename suffix, the same convention
    // `playwright.dev.config.ts` uses:
    //   *.coarse.pw.ts  -> coarse only
    //   everything else -> desktop only
    // The coarse rules in `ui.css` are switched OFF on a fine pointer, so a
    // spec that checks one from the desktop lane passes while proving nothing.
    // The dev lane already has a coarse project but cannot list a library —
    // it activates no SiteProject — and a table is the one thing the coarse
    // block still promises 44px to that only a listing can produce.
    { name: "desktop", testIgnore: "**/*.coarse.pw.ts" },
    {
      name: "coarse",
      testMatch: "**/*.coarse.pw.ts",
      use: { hasTouch: true, viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: "pnpm exec vite preview --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
