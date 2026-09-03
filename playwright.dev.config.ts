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
    // Three lanes, chosen by filename suffix, so a spec never runs under a
    // viewport it was not written for:
    //   *.coarse.pw.ts      -> coarse only
    //   *.responsive.pw.ts  -> BOTH desktop and coarse (same spec, two viewports)
    //   everything else     -> desktop only
    // Issues #162 and #166 require the outline-tree layout-shift proof to run on
    // both the fine and coarse projects, which is what the responsive suffix is for.
    { name: "desktop", testIgnore: "**/*.coarse.pw.ts" },
    // Coarse-pointer lane for 44px-target and insert-affordance checks: a
    // touch-capable viewport at the narrowest phone size the chrome supports.
    {
      name: "coarse",
      testMatch: ["**/*.coarse.pw.ts", "**/*.responsive.pw.ts"],
      use: { hasTouch: true, viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: "corepack pnpm dev",
    url: "http://localhost:5173",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
