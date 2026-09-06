import { defineConfig, devices } from "@playwright/test";
import { requireIsolatedRoots } from "./tests/browser/isolated-roots";

const { releaseRoot, mediaRoot } = requireIsolatedRoots(process.env);

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/site-project-acceptance.pw.ts",
  outputDir: "./test-results/playwright-site-project-dist",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4174",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "pnpm exec wrangler dev --local --ip 127.0.0.1 --port 4174",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      ...process.env,
      ZUDO_SITE_PROJECT_ROOT: releaseRoot,
      ZUDO_MEDIA_STORE_ROOT: mediaRoot,
      CLOUDFLARE_API_TOKEN: "",
      CLOUDFLARE_ACCOUNT_ID: "",
    },
  },
});
