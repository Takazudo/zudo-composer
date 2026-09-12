import { defineConfig, devices } from "@playwright/test";
import { requireDemosLaneContext } from "./tests/browser-demos/isolated-context";

// This lane's one machine-global port. Never one of the other browser lanes'
// ports (4173/4174/4175/5173) — none of them may run concurrently.
const PORT = 4176;
if ([4173, 4174, 4175, 5173].includes(PORT)) throw new Error(`Demos lane port ${PORT} collides with an existing browser lane.`);

const { name, assetsStoreRoot } = requireDemosLaneContext(process.env);

export default defineConfig({
  testDir: "./tests/browser-demos",
  // One demo, one server, one spec file: `run-demos-browser.mjs` invokes this
  // config once per demo, each with its own name, routes and Assets root.
  testMatch: `${name}.pw.ts`,
  outputDir: `./test-results/playwright-demos/${name}`,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    // Pin the bind address the probe uses: on the Linux CI runner Node resolves
    // `localhost` to `::1`, so a default bind never answers on 127.0.0.1.
    command: `pnpm --filter demo-${name} dev --host 127.0.0.1 --port ${PORT} --strict-port`,
    // The shell middleware answers only requests that accept `text/html`, so
    // readiness polls Vite's own client module instead — served by the dev
    // server itself, and 200 as soon as it listens (same probe as the host
    // lane, `playwright.host.config.ts`).
    url: `http://127.0.0.1:${PORT}/@vite/client`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { ...process.env, ZUDO_ASSETS_STORE_ROOT: assetsStoreRoot },
  },
});
