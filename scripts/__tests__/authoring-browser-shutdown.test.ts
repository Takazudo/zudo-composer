// @vitest-environment node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vitest";

// Every authoring lane owns a filesystem lease. Playwright's default SIGKILL
// leaves that lease behind, breaking the next spec's fresh server startup.
it.each(["dev", "host", "demos", "site-project"])("the %s browser lane drains its authoring server instead of force-killing it", async lane => {
  const source = await readFile(resolve(import.meta.dirname, `../../playwright.${lane}.config.ts`), "utf8");
  expect(source).toMatch(/gracefulShutdown:\s*\{\s*signal:\s*"SIGTERM",\s*timeout:\s*0\s*\}/u);
});
