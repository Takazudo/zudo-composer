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
    // The same filename convention `playwright.dev.config.ts` uses, so a spec
    // does not change lanes by moving between them:
    //   *.coarse.pw.ts      -> coarse only
    //   *.responsive.pw.ts  -> BOTH desktop and coarse
    //   everything else     -> desktop only
    // The coarse rules in `ui.css` are switched OFF on a fine pointer, so a
    // coarse spec that reached the desktop project would pass while proving
    // nothing. This lane needs a coarse project of its own because the dev
    // lane, which has one, activates no SiteProject and so can never render a
    // library table — the one surface the coarse block still promises 44px to
    // that only a listing can produce.
    { name: "desktop", testIgnore: "**/*.coarse.pw.ts" },
    {
      name: "coarse",
      testMatch: ["**/*.coarse.pw.ts", "**/*.responsive.pw.ts"],
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
