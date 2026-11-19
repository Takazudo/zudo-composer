/**
 * Outline row actions stay clickable when a slug and a rule tag are long (#989).
 *
 * The slug, the rule hint and the rule tag are painted inside the row button.
 * On a narrow rail they used to overflow that button and sit on top of
 * "Add component" and Collapse, so elementFromPoint at the button centre
 * returned the text. A unit test cannot see that: jsdom does not hit-test.
 * This spec mounts the real tree at the acceptance viewport and asks the
 * browser which element owns each action's centre.
 */

import { expect, test } from "@playwright/test";

/** Default structure-rail width. Wide enough for a title, narrow enough that a long slug overflows. */
const RAIL_WIDTH = "280px";

interface ActionHit {
  label: string | null;
  width: number;
  height: number;
  ok: boolean;
  hit: string | null;
}

test("row actions stay under the pointer when the slug and rule tag are long", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.goto("/");
  await page.evaluate(async (width) => {
    // Variable specifiers: the Vite dev server resolves them, and tsc must not.
    const stylePath = "/src/style.css";
    const mountPath = "/tests/browser-dev/outline-row-hit-mount.ts";
    await import(stylePath);
    const host = document.createElement("div");
    host.id = "outline-hit-probe";
    host.style.cssText = `position:fixed; z-index:2147483646; top:72px; left:16px; width:${width}; background:canvas;`;
    document.body.appendChild(host);
    const { mountOutlineHitProbe } = await import(mountPath);
    mountOutlineHitProbe(host);
  }, RAIL_WIDTH);

  const probe = page.locator("#outline-hit-probe");
  await expect(probe.getByRole("treeitem", { name: /3 kinds/ }).first()).toBeVisible();
  const rows = probe.locator(".cms-tree-cat__row, .cms-tree-group__header, .cms-tree-leaf-wrap");
  await expect(rows).toHaveCount(3);

  const hits: ActionHit[] = [];
  for (const row of await rows.all()) {
    await row.hover();
    await expect.poll(() => row.locator(".cms-tree-acts").evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
    hits.push(
      ...(await row.evaluate((element): ActionHit[] => {
        return [...element.querySelectorAll<HTMLElement>(".cms-tree-acts button, .cms-tree-toggle")].map((button) => {
          const box = button.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          const described = hit === null ? null : `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ""}${hit.className ? `.${String(hit.className).trim().split(/\s+/u).join(".")}` : ""}`;
          return {
            label: button.getAttribute("aria-label"),
            width: box.width,
            height: box.height,
            ok: hit !== null && button.contains(hit),
            hit: described,
          };
        });
      })),
    );
  }

  expect(hits.map((hit) => hit.label)).toEqual([
    "Add component to Document",
    "Insert options for Document",
    "Collapse Document",
    "Add component to items",
    "Insert options for items",
    "Collapse items",
    "Add component to SectionHeading",
    "Insert options for SectionHeading",
  ]);
  for (const hit of hits) {
    expect(hit.width, hit.label ?? "action").toBeGreaterThan(0);
    expect(hit.height, hit.label ?? "action").toBeGreaterThan(0);
    expect(hit.ok, `${hit.label} centre hit ${hit.hit}`).toBe(true);
  }
});
