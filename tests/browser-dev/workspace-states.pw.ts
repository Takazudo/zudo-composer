import { expect, test } from "@playwright/test";
import { ensureDevWorkspace } from "./workspace-bootstrap";

test("missing IndexedDB is an explicit unavailable workspace, not synthetic editable data", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(globalThis, "indexedDB", { value: undefined, configurable: true }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Open workspace" })).toBeVisible();
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry opening", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create catalog & editorial example" })).toHaveCount(0);
});

test("Media loading, unavailable and no-match states retain actionable truth", async ({ page }) => {
  await ensureDevWorkspace(page);
  let resume!: () => void;
  const paused = new Promise<void>((resolve) => { resume = resolve; });
  await page.route("**/__zudo_composer_media_file_provider", async (route) => {
    await paused;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "unavailable", message: "Injected browser availability failure" } }) });
  });
  await page.goto("/media");
  await expect(page.getByText("Loading media…", { exact: true })).toBeVisible();
  resume();
  await expect(page.getByRole("button", { name: "Retry loading", exact: true })).toBeVisible();
  await expect(page.getByRole("alert").first()).toBeVisible();
  await page.unroute("**/__zudo_composer_media_file_provider");
  await page.getByRole("button", { name: "Retry loading", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search media" }).fill("no-assets-can-match-this-browser-probe");
  await expect(page.getByText("No assets match these filters.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Trash…", exact: true })).toBeDisabled();
});
