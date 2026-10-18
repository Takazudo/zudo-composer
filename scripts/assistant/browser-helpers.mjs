// @ts-check
/* global CSS */
// Page-level Assistant UI helpers shared by the fake-provider and live browser lanes.
import { expect } from "@playwright/test";

/** @param {import('@playwright/test').Page} page @param {number} [timeout] */
export async function idle(page, timeout = 60_000) {
  await expect(page.locator('.cms-assistant-message[aria-busy="true"]')).toHaveCount(0, { timeout });
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
}
/** @param {import('@playwright/test').Page} page @param {string} text @param {number} [timeout] */
export async function send(page, text, timeout = 60_000) {
  const replies = page.locator('.cms-assistant-message[data-role="assistant"]:not([aria-busy])');
  const before = await replies.count();
  await page.locator("#assistant-input").fill(text);
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole("button", { name: "Send" }).click();
  await expect(replies).toHaveCount(before + 1, { timeout });
  await idle(page, timeout);
}
/** @param {import('@playwright/test').Page} page */
export const lastReply = page => page.locator('.cms-assistant-message[data-role="assistant"]').last();
/** @param {import('@playwright/test').Page} page */
export const count = page => page.locator(".cms-assistant-review .cms-assistant-count").first();
/** @param {import('@playwright/test').Page} page @param {"Draft" | "Current"} kind */
export const frame = (page, kind) => page.frameLocator(`iframe[title="${kind} page preview"]`);
/** Words marked by the review highlight in one preview. @param {import('@playwright/test').FrameLocator} preview @param {"zc-review-insert" | "zc-review-delete"} [name] */
export const highlighted = (preview, name = "zc-review-insert") => preview.locator("body").evaluate((_body, key) => {
  const value = /** @type {any} */ (CSS).highlights?.get(key);
  return value ? [...value].map((/** @type {Range} */ range) => range.toString()) : [];
}, name);
