import { expect, test, type Page } from "@playwright/test";
import { ensureDevWorkspace } from "./workspace-bootstrap";

type FocusProbeState = "closed" | "A" | "B" | "route";
type FocusProbeWindow = Window & {
  focusProbeSet?: (next: FocusProbeState) => void;
};

async function openCreateProjectDialog(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Open workspace" })).toBeVisible();
  const trigger = page.getByRole("button", { name: "Create project", exact: true });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Create project", exact: true });
  await expect(dialog).toBeVisible();
  return { dialog, trigger };
}

async function mountFocusProbe(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Open workspace" })).toBeVisible();
  await page.evaluate(async () => {
    const loadedModule = (filename: string) => {
      const url = performance.getEntriesByType("resource").map((entry) => entry.name)
        .find((resource) => new URL(resource).pathname.endsWith(`/node_modules/.vite/deps/${filename}`));
      if (!url) throw new Error(`App has not loaded ${filename}`);
      return url;
    };
    // Reuse the exact versioned URLs Vite loaded for the app. Bare browser
    // specifiers are unresolved here, and unversioned optimized-module URLs
    // can load a second Preact instance in the probe.
    const preactPath = loadedModule("preact.js");
    const hooksPath = loadedModule("preact_hooks.js");
    const dialogPath = "/src/components/overlay/dialog.tsx";
    const { h, render } = await import(preactPath);
    const { useState } = await import(hooksPath);
    const { Dialog } = await import(dialogPath);
    const root = document.createElement("div");
    root.id = "focus-probe";
    document.body.append(root);

    function Harness() {
      const [state, setState] = useState("closed");
      (window as FocusProbeWindow).focusProbeSet = (next) => setState(next);
      if (state === "route") return h("main", { id: "new-route" }, "New route");
      return h(
        "section",
        {},
        h("button", { id: "probe-opener", onClick: () => setState("A") }, "Probe open"),
        state !== "closed" && h(
          Dialog,
          { key: state, open: true, label: state, onClose: () => setState("closed") },
          h("button", { id: `inside-${state}`, onClick: () => setState(state === "A" ? "B" : "closed") }, state === "A" ? "Replace" : "Finish"),
        ),
      );
    }

    render(h(Harness, {}), root);
  });
  await page.getByRole("button", { name: "Probe open", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "A", exact: true })).toBeVisible();
}

for (const width of [1440, 1000, 390]) {
  test(`Create project restores focus after Escape at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { dialog, trigger } = await openCreateProjectDialog(page);
    expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(true);
    await expect(dialog.getByRole("textbox", { name: "Project name", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}

test("same-commit native dialog replacement restores the original opener after B closes", async ({ page }) => {
  await mountFocusProbe(page);
  const dialogA = page.getByRole("dialog", { name: "A", exact: true });
  await expect(dialogA).toHaveJSProperty("open", true);
  await expect(dialogA).toHaveCount(1);
  expect(await dialogA.evaluate((element) => element.matches(":modal"))).toBe(true);
  await page.locator("#inside-A").click();

  const dialogB = page.getByRole("dialog", { name: "B", exact: true });
  await expect(dialogA).toHaveCount(0);
  await expect(dialogB).toBeVisible();
  await expect(dialogB.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialogB).toHaveCount(0);
  await expect(page.locator("#probe-opener")).toBeFocused();
});

test("removing the dialog and opener together lands on the new route without an error", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mountFocusProbe(page);
  await page.evaluate(() => (window as FocusProbeWindow).focusProbeSet?.("route"));
  await expect(page.locator("#new-route")).toBeVisible();
  await expect(page.locator("#probe-opener")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "A", exact: true })).toHaveCount(0);
  await expect(page.locator("body")).toBeFocused();
  expect(errors).toEqual([]);
});

test("forced non-modal fallback restores Create project focus after Escape", async ({ page }) => {
  await page.addInitScript(() => {
    const dialogPrototype = HTMLDialogElement.prototype as unknown as { showModal?: () => void };
    delete dialogPrototype.showModal;
  });
  const { dialog, trigger } = await openCreateProjectDialog(page);
  expect(await page.evaluate(() => typeof HTMLDialogElement.prototype.showModal)).toBe("undefined");
  expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(false);
  await expect(dialog.getByRole("textbox", { name: "Project name", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

// These focus tests intentionally precede the Media test below: the browser
// runner shares one disposable source root within a spec, and that test
// initializes a workspace through ensureDevWorkspace.

// The workspace source is the host's filesystem, reached through the workspace
// domain provider. Refusing that endpoint is the only way to reach the
// unavailable state on purpose — the browser holds no workspace storage of its
// own to take away.
test("an unavailable workspace source stays explicit, not synthetic editable data", async ({ page }) => {
  await page.route("**/__zudo_composer_workspace_provider", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ ok: false, error: { domain: "workspace", operation: "list", code: "unavailable", message: "Injected browser availability failure" } }),
  }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Open workspace" })).toBeVisible();
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry opening", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create fresh workspace", exact: true })).toBeVisible();
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
