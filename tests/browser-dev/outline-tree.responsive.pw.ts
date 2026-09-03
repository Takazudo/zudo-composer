/**
 * Outline tree — no row moves (epic #156, issue #162).
 *
 * The insert affordance is the whole reason this spec exists. Between every
 * pair of sibling rows sits a container that is 0px high at all times; its hit
 * zone, dashed line, `+` tile and inline editor are all absolutely positioned
 * on the row boundary. That technique is only worth anything if it is true in a
 * real browser, so the proof is the one thing a unit test cannot give:
 * `getBoundingClientRect()` of every row, before and after hovering a gap and
 * while its inline editor is open.
 *
 * The `.responsive.pw.ts` suffix is load-bearing — `playwright.dev.config.ts`
 * routes it to BOTH the desktop and the coarse project, which is what #162
 * asks for. Renaming the file silently drops the coarse half.
 *
 * The Sitemapper route adopts `OutlineTree` in issue #165. Until it does the
 * test skips with that reason rather than failing, and it starts running on its
 * own the moment the route renders a tree — there is nothing to switch on.
 */

import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

const TREE = ".cms-tree";
/** Every element that draws a row. Their boxes are the layout contract. */
const ROWS = ".cms-tree-cat__row, .cms-tree-group__header, .cms-tree-leaf-wrap, .cms-tree-add-wrap";
/** A boundary between two siblings — any one of them proves the invariant. */
const GAP = ".cms-tree-insert";
/** The terminal add row of the root category, used only to seed two siblings. */
const ADD_ROW = ".cms-tree-cat > .cms-tree-children > .cms-tree-add-wrap .cms-tree-add";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TreeGeometry {
  tree: Box;
  /** `label` only names the row in a failure message; `box` is the assertion. */
  rows: { label: string; box: Box }[];
  scrollX: number;
  scrollY: number;
}

/**
 * Every row box in one pass, plus the tree's own box and the page scroll — so a
 * stray scroll between two readings shows up as an obvious diff instead of
 * masquerading as every row having moved by the same amount.
 */
async function readGeometry(page: Page): Promise<TreeGeometry> {
  return page.evaluate(
    ({ tree: treeSelector, rows: rowSelector }) => {
      const round = (value: number) => Math.round(value * 100) / 100;
      const box = (element: Element): Box => {
        const rect = element.getBoundingClientRect();
        return { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) };
      };
      const tree = document.querySelector(treeSelector);
      if (tree === null) throw new Error("The outline tree left the page mid-measurement.");
      return {
        tree: box(tree),
        rows: [...tree.querySelectorAll(rowSelector)].map((row) => ({
          label: (row.textContent ?? "").replace(/\s+/gu, " ").trim().slice(0, 48),
          box: box(row),
        })),
        scrollX: round(window.scrollX),
        scrollY: round(window.scrollY),
      };
    },
    { tree: TREE, rows: ROWS },
  );
}

async function opacityOf(locator: Locator): Promise<number> {
  return Number(await locator.evaluate((element) => getComputedStyle(element).opacity));
}

async function openSitemapper(page: Page, name: string): Promise<void> {
  await page.goto("/sitemapper");
  await expect(page.getByRole("heading", { name: "Sitemaps", exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "New sitemap" }).click();
  const dialog = page.getByRole("dialog", { name: "Create sitemap" });
  await dialog.getByRole("textbox", { name: "Sitemap name" }).fill(name);
  await dialog.getByRole("button", { name: "Create sitemap" }).click();
  await expect(page.getByRole("toolbar", { name: "Sitemapper toolbar" })).toBeVisible();
}

/**
 * A brand-new sitemap holds a single root page, so there is no boundary between
 * siblings to hover yet. The tree's own terminal add row makes two — which also
 * exercises the inline editor against the host's real add command.
 */
async function ensureSiblingGap(page: Page): Promise<Locator> {
  if ((await page.locator(GAP).count()) === 0) {
    for (const title of ["Layout probe alpha", "Layout probe beta"]) {
      await page.locator(ADD_ROW).first().click();
      const input = page.locator(".cms-tree-add-wrap .cms-tree-inline input").first();
      await expect(input).toBeFocused();
      await input.fill(title);
      await input.press("Enter");
      await expect(page.getByRole("treeitem", { name: title })).toBeVisible();
    }
  }
  const gap = page.locator(GAP).first();
  await expect(gap).toBeAttached();
  return gap;
}

test("no outline row moves when a gap is hovered or its inline editor is open", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const coarseLane = testInfo.project.name === "coarse";

  await openSitemapper(page, `Outline layout probe ${testInfo.project.name}`);

  const tree = page.locator(TREE).first();
  test.skip(
    (await page.locator(TREE).count()) === 0,
    "The Sitemapper route has not adopted OutlineTree yet (issue #165).",
  );
  await expect(tree).toBeVisible();

  // A coarse project that is not actually coarse would make the second half of
  // #162's acceptance vacuous, so the lane proves itself before anything else.
  await expect
    .poll(() => page.evaluate(() => window.matchMedia("(pointer: coarse)").matches))
    .toBe(coarseLane);

  const gap = await ensureSiblingGap(page);
  const hit = gap.locator(".cms-tree-insert__hit");
  const tile = gap.locator(".cms-tree-insert__btn");

  await test.step("the container costs no height and its hit zone is reachable", async () => {
    expect(await gap.evaluate((element) => element.getBoundingClientRect().height)).toBe(0);
    const hitBox = await hit.boundingBox();
    expect(hitBox).not.toBeNull();
    // ±0.55rem on a fine pointer, ±22px on a coarse one.
    expect(hitBox!.height).toBeGreaterThanOrEqual(coarseLane ? 40 : 16);
  });

  await hit.scrollIntoViewIfNeeded();
  const baseline = await readGeometry(page);
  expect(baseline.rows.length).toBeGreaterThan(1);

  await test.step("hovering the gap reveals the tile and moves nothing", async () => {
    // On a coarse pointer the line and tile stay visible at 0.55 instead of
    // waiting for a hover that will never arrive.
    if (coarseLane) expect(await opacityOf(tile)).toBeGreaterThan(0);
    else expect(await opacityOf(tile)).toBe(0);

    await hit.hover();
    expect(await opacityOf(tile)).toBeGreaterThan(0);
    expect(await readGeometry(page)).toEqual(baseline);
  });

  await test.step("the open inline editor floats on the boundary and moves nothing", async () => {
    await tile.click();
    const editor = gap.locator(".cms-tree-inline");
    await expect(editor).toBeVisible();
    await expect(gap).toHaveClass(/\bis-active\b/u);
    expect(await editor.evaluate((element) => getComputedStyle(element).position)).toBe("absolute");

    const input = editor.locator("input");
    await expect(input).toBeFocused();
    expect(await readGeometry(page)).toEqual(baseline);

    // A filled editor is wider than an empty one; still nothing may move.
    await input.fill("Layout probe insert");
    expect(await readGeometry(page)).toEqual(baseline);

    await input.press("Escape");
    await expect(editor).toHaveCount(0);
    expect(await readGeometry(page)).toEqual(baseline);
  });

  await test.step("the affordance hides again and leaves the rows where they were", async () => {
    await page.mouse.move(0, 0);
    if (!coarseLane) await expect.poll(() => opacityOf(tile)).toBe(0);
    expect(await readGeometry(page)).toEqual(baseline);
  });
});
