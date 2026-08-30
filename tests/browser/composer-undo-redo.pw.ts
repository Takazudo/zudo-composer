import { expect, test, type Page } from "@playwright/test";

function watchRuntimeFailures(page: Page) {
  const failures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  page.on("requestfailed", (request) => {
    const errorText = request.failure()?.errorText;
    if (errorText === "net::ERR_ABORTED") return;
    failures.push(`request: ${request.url()} (${errorText})`);
  });
  return failures;
}

test("Composer composes, edits, and recovers through toolbar and canvas history", async ({ page }) => {
  test.setTimeout(120_000);
  const failures = watchRuntimeFailures(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/composer");
  await expect(page.getByRole("heading", { name: "Composition library" })).toBeVisible();
  await page.getByRole("button", { name: "Open Product overview" }).click();

  const toolbar = page.getByRole("toolbar", { name: "Composer toolbar" });
  const undo = toolbar.getByRole("button", { name: "Undo" });
  const redo = toolbar.getByRole("button", { name: "Redo" });
  const mode = page.getByRole("group", { name: "Composer mode" });
  const canvas = page.frameLocator('iframe[title="Composer preview canvas"]');

  await expect(toolbar).toBeVisible();
  await expect(canvas.getByText("A real provider composition", { exact: true })).toBeVisible();
  // A fresh controller is at both ends of an empty history stack.
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();

  // Compose a real provider node through the production chooser.
  await page.getByRole("button", { name: "Add component to document root" }).click();
  const chooser = page.getByRole("dialog", { name: /Add to Document root/i });
  await expect(chooser).toBeVisible();
  await chooser.getByRole("button", { name: "SectionHeading", exact: true }).click();
  await expect(canvas.getByRole("heading", { name: "Our approach", exact: true })).toBeVisible();
  await expect(undo).toBeEnabled();
  await expect(redo).toBeDisabled();

  // Toolbar undo/redo must move the composed node itself through the stack.
  await undo.click();
  await expect(canvas.getByRole("heading", { name: "Our approach", exact: true })).toHaveCount(0);
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect(canvas.getByRole("heading", { name: "Our approach", exact: true })).toBeVisible();
  await expect(undo).toBeEnabled();
  await expect(redo).toBeDisabled();

  const addedRow = page.locator("[data-sg-tree-node-id]").filter({ hasText: "Our approach" });
  await expect(addedRow).toHaveCount(1);
  await addedRow.getByRole("button", { name: "SectionHeading Our approach", exact: true }).click();
  const addedNodeId = await addedRow.getAttribute("data-sg-tree-node-id");
  expect(addedNodeId).not.toBeNull();
  const addedNode = page.locator(`[data-sg-tree-node-id="${addedNodeId}"]`);

  // Edit a real prop, then prove the toolbar restores and re-applies that value.
  const heading = page.getByRole("textbox", { name: "Heading", exact: true });
  await expect(heading).toHaveValue("Our approach");
  await heading.fill("Toolbar history heading");
  await heading.blur();
  await expect(canvas.getByRole("heading", { name: "Toolbar history heading", exact: true })).toBeVisible();
  await undo.click();
  await expect(canvas.getByRole("heading", { name: "Our approach", exact: true })).toBeVisible();
  await expect(canvas.getByRole("heading", { name: "Toolbar history heading", exact: true })).toHaveCount(0);
  await redo.click();
  await expect(canvas.getByRole("heading", { name: "Toolbar history heading", exact: true })).toBeVisible();

  // A second prop edit is undone and redone from a control focused inside the
  // actual canvas iframe. This is the regression-sensitive relay path.
  const intro = page.getByRole("textbox", { name: "Intro", exact: true });
  await expect(intro).toHaveValue("A short supporting sentence.");
  await intro.fill("Keyboard history intro");
  await intro.blur();
  await expect(canvas.getByText("Keyboard history intro", { exact: true })).toBeVisible();

  const canvasMenu = canvas.getByRole("button", { name: "Open menu for SectionHeading" });
  await canvasMenu.focus();
  await expect(canvasMenu).toBeFocused();
  await page.keyboard.press("Control+z");
  await expect(canvasMenu).toBeFocused();
  await expect(canvas.getByText("A short supporting sentence.", { exact: true })).toBeVisible();
  await expect(canvas.getByText("Keyboard history intro", { exact: true })).toHaveCount(0);
  await expect(redo).toBeEnabled();

  await canvasMenu.focus();
  await expect(canvasMenu).toBeFocused();
  await page.keyboard.press("Control+Shift+z");
  await expect(canvas.getByText("Keyboard history intro", { exact: true })).toBeVisible();

  // Removal is a single direct action now that confirmation is retired; its
  // previous document is recoverable from the same history stack.
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(addedNode).toHaveCount(0);
  await expect(canvas.getByRole("heading", { name: "Toolbar history heading", exact: true })).toHaveCount(0);
  await expect(page.locator("dialog:visible")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove", exact: true })).toHaveCount(0);

  await undo.click();
  await expect(addedNode).toHaveCount(1);
  await expect(canvas.getByRole("heading", { name: "Toolbar history heading", exact: true })).toBeVisible();
  await expect(canvas.getByText("Keyboard history intro", { exact: true })).toBeVisible();
  await expect(page.locator("dialog:visible")).toHaveCount(0);

  // Redo reaches the latest stack end; undo is then the only enabled history action.
  await redo.click();
  await expect(addedNode).toHaveCount(0);
  await expect(redo).toBeDisabled();
  await expect(undo).toBeEnabled();

  // Restore the node so Preview can prove read-only history controls while a
  // real authored component remains visible.
  await undo.click();
  await expect(addedNode).toHaveCount(1);
  await mode.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(mode.getByRole("button", { name: "Preview", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  await expect(page.getByText("Preview mode — properties are read-only.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add component to document root" })).toHaveCount(0);

  expect(failures).toEqual([]);
});
