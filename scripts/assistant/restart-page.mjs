// @ts-check
/**
 * Restart a dev host without racing its old Vite client's automatic reload.
 * Parking the same tab disposes that client before shutdown, while preserving
 * the host origin's sessionStorage for a genuinely fresh document afterward.
 * No failed navigation is swallowed or retried.
 * @param {Pick<import('@playwright/test').Page, 'url' | 'goto'>} page
 * @param {() => Promise<void>} restart
 */
export async function restartPageHost(page, restart) {
  const url = page.url();
  await page.goto("about:blank");
  await restart();
  await page.goto(url);
}
