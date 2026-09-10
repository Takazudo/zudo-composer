import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { requireHostRoot } from "./tests/browser/isolated-host";

// The installed-host lane: the package's own `bin`, rooted at a disposable host
// project, which is how every real host runs it. It replaced a `vite preview`
// lane over `dist/`; a static build has no file-provider middleware, so once
// storage moved onto the filesystem that lane could not author anything.
const appRoot = resolve(fileURLToPath(import.meta.url), "..");
const hostRoot = requireHostRoot(process.env);

/** Owned by `playwright.site-project.config.ts`, which activates its own release. */
const SITE_PROJECT_SPEC = "**/site-project-acceptance.pw.ts";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.pw.ts",
  outputDir: "./test-results/playwright-host",
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
    // Routed by filename, the same convention `playwright.dev.config.ts` uses,
    // so a spec does not change viewport by moving between lanes:
    //   *.coarse.pw.ts      -> coarse only
    //   *.responsive.pw.ts  -> BOTH desktop and coarse
    //   everything else     -> desktop only
    // The coarse rules in `ui.css` are switched OFF on a fine pointer, so a
    // coarse spec that reached the desktop project would pass while proving
    // nothing.
    // A project's own `testIgnore` REPLACES the top-level one, so the
    // SiteProject spec — which needs its own activated release and its own lane
    // — is named in each project rather than once above.
    { name: "desktop", testIgnore: ["**/*.coarse.pw.ts", SITE_PROJECT_SPEC] },
    {
      name: "coarse",
      testMatch: ["**/*.coarse.pw.ts", "**/*.responsive.pw.ts"],
      testIgnore: SITE_PROJECT_SPEC,
      use: { hasTouch: true, viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: `node ${JSON.stringify(resolve(appRoot, "bin/zudo-composer.mjs"))} dev --root ${JSON.stringify(hostRoot)} --host 127.0.0.1 --port 4173 --strict-port`,
    // The shell middleware answers only requests that accept `text/html`, so
    // that a missing asset stays a 404 instead of becoming HTML. Playwright's
    // readiness probe sends no such header, so it polls Vite's own client
    // module — served by the dev server itself, and 200 as soon as it listens.
    // Listener readiness only means the server can answer. Host fixtures gate
    // each adopted document transition on its exact semantic target and shell
    // busy-state settlement within the test's own total deadline.
    url: "http://127.0.0.1:4173/@vite/client",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
