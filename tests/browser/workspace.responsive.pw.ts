import { expect, test, type Page } from "@playwright/test";

export const WORKSPACE_WIDTHS = [1440, 1100, 761, 760, 390] as const;
const modules = [
  ["/", /^Good (morning|afternoon|evening)\.$/],
  ["/content", "Content"], ["/composer", "Compositions"],
  ["/mapping", "Mappings"], ["/sitemapper", "Sitemaps"],
  ["/media", "Media"], ["/review", "Review & release"],
] as const;
const navigationNames = ["Overview", "Content", "Media", "Compositions", "Mappings", "Sitemaps", "Review & release", "Website preview — choose preview source"];
async function noOverflow(page: Page) {
  const root = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(root.scroll).toBeLessThanOrEqual(root.width);
  const boxes = await page.locator(".cms-editor__region:visible").evaluateAll((elements) => elements.map((element) => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, bottom: r.bottom, width: innerWidth, height: innerHeight }; }));
  for (const box of boxes) { expect(box.left).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(box.width + 1); expect(box.bottom).toBeLessThanOrEqual(box.height + 1); }
}

for (const width of WORKSPACE_WIDTHS) for (const theme of ["light", "dark"] as const) {
  test(`workspace modules ${width}px ${theme}, reduced motion and navigation focus`, async ({ page }, info) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    for (const [path, heading] of modules) {
      await page.goto(path);
      if (path === "/content") await expect(page.getByRole("region", { name: "Editor", exact: true })).toBeVisible();
      else await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
      await page.getByRole("button", { name: /^Theme:/ }).click();
      await page.getByRole("menuitemradio", { name: theme === "light" ? "Light" : "Dark", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
      if (width <= 760) {
        const trigger = page.getByRole("button", { name: "Expand navigation", exact: true });
        await trigger.focus(); await page.keyboard.press("Enter");
        const drawer = page.getByRole("dialog", { name: "Navigation", exact: true });
        await expect(drawer).toBeVisible();
        for (const name of navigationNames) await expect(drawer.getByRole("link", { name, exact: true })).toBeVisible();
        await page.keyboard.press("Tab");
        expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
        await page.keyboard.press("Escape"); await expect(drawer).toBeHidden(); await expect(trigger).toBeFocused();
      } else {
        const collapse = page.getByRole("button", { name: "Collapse sidebar", exact: true });
        await collapse.click(); await expect(page.locator(".app-shell")).toHaveAttribute("data-rail", "collapsed");
        await page.reload(); await expect(page.locator(".app-shell")).toHaveAttribute("data-rail", "collapsed");
        await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
        for (const name of navigationNames) await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name, exact: true })).toBeVisible();
      }
      await noOverflow(page);
      await page.screenshot({ path: info.outputPath(`${path.replaceAll("/", "") || "overview"}-${width}-${theme}.png`), fullPage: true });
    }
    expect(errors).toEqual([]);
  });
}

test("static capabilities and stale targets remain truthful instead of silently selecting another record", async ({ page }) => {
  await page.goto("/review");
  await expect(page.getByText(/Static read-only mode/)).toBeVisible();
  for (const name of ["Run release checks", "Apply / stage exact candidate", "Build staged candidate", "Activate locally"]) await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
  await page.goto("/media?provider=media-files&asset=missing-browser-asset");
  await expect(page.getByRole("alert").first()).toBeVisible();
  await page.goto("/content?provider=unknown-provider&model=missing");
  await expect(page.getByRole("heading", { name: "Invalid workspace link" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("unavailable");
});

test("coarse navigation controls are real touch targets", async ({ page }, info) => {
  // Desktop runs the same source for geometry; coarse proves real pointer media.
  const coarse = info.project.name === "coarse";
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/");
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(coarse);
  const trigger = page.getByRole("button", { name: "Expand navigation", exact: true });
  if (coarse) await trigger.tap(); else await trigger.click();
  const drawer = page.getByRole("dialog", { name: "Navigation", exact: true });
  // The modal translates during entry. Wait for stable geometry before
  // measuring: fractional transformed edges can subtract to 43.99998px.
  await expect(drawer).toHaveCSS("transform", "none");
  for (const link of await drawer.getByRole("navigation", { name: "Main navigation" }).getByRole("link").all()) {
    if (coarse) await expect(link).toHaveCSS("min-height", "44px");
    const box = await link.boundingBox(); expect(box).not.toBeNull(); if (coarse) expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused(); await noOverflow(page);
});
