import { expect, test, type Page, type Response } from "@playwright/test";

const SITE_ROUTES = [
  "/site",
  "/site/about",
  "/site/services",
  "/site/journal",
  "/site/journal/map-the-moving-parts",
  "/site/journal/review-in-small-loops",
  "/site/journal/start-with-the-question",
] as const;
const BROWSER_LANE = process.env.SITE_PROJECT_BROWSER_LANE ?? "dist";

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

async function useTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((value) => {
    localStorage.setItem("zudo-composer-theme", value);
    document.documentElement.dataset.theme = value;
  }, theme);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

async function expectSiteChrome(page: Page, route: string) {
  const primary = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(primary.getByRole("link")).toHaveText(["Home", "About", "Services", "Journal"]);
  const breadcrumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  if (route === "/site") {
    await expect(breadcrumbs).toHaveCount(0);
  } else {
    await expect(breadcrumbs).toBeVisible();
    await expect(breadcrumbs.getByRole("link").first()).toHaveText("Home");
    if (route.startsWith("/site/journal/")) await expect(breadcrumbs.getByRole("link").nth(1)).toHaveText("Journal");
  }
}

async function expectRouteContent(page: Page, route: string) {
  const headings: Record<string, string> = {
    "/site": "Clear ideas, carefully shaped",
    "/site/about": "A studio built around useful clarity",
    "/site/services": "Ways to work together",
    "/site/journal": "Working notes",
    "/site/journal/map-the-moving-parts": "Map the moving parts",
    "/site/journal/review-in-small-loops": "Review in small loops",
    "/site/journal/start-with-the-question": "Start with the question",
  };
  await expect(page.getByRole("heading", { name: headings[route]!, exact: true })).toBeVisible();
  if (route === "/site/about") await expect(page.getByText("Work made visible", { exact: true })).toBeVisible();
  if (route === "/site/journal/map-the-moving-parts") await expect(page.getByText("Draw the relationships", { exact: true })).toBeVisible();
  if (route === "/site/journal/review-in-small-loops") await expect(page.getByText("Share something concrete", { exact: true })).toBeVisible();
  if (route === "/site/journal/start-with-the-question") await expect(page.getByText("Begin with purpose", { exact: true })).toBeVisible();
}

test("the activated graph appears in every authoring library", async ({ page }) => {
  const failures = watchRuntimeFailures(page);
  await page.goto("/composer");
  await expect(page.getByRole("heading", { name: "Composition library" })).toBeVisible();
  for (const name of ["About page", "Home page", "Journal entry page", "Journal index page", "Services page", "Site frame"]) {
    await expect(page.getByRole("button", { name: `Open ${name}`, exact: true })).toBeVisible();
  }

  await page.goto("/content");
  // Content's library is its navigator since issue #169: one `»` category per
  // model, carrying its id, Entry count and `single` tag.
  const contentTree = page.getByRole("tree", { name: "Content" });
  await expect(contentTree).toBeVisible();
  const aboutModel = contentTree.getByRole("treeitem", { name: /^About content/ });
  await expect(aboutModel).toBeVisible();
  await expect(aboutModel).toContainText("single");
  await expect(contentTree.getByRole("treeitem", { name: /^Journal articles/ })).toBeVisible();

  await page.goto("/mapping");
  await expect(page.getByRole("heading", { name: "Mapping library" })).toBeVisible();
  // Issue #171 put the Mapping library on `LibraryPage`: the name is a link and
  // readiness is a column, so each row is found by its link and then read.
  for (const name of ["About page mapping", "Journal entry mapping"]) {
    const row = page.getByRole("row").filter({ has: page.getByRole("link", { name, exact: true }) });
    await expect(row.getByText("Ready", { exact: true })).toBeVisible();
  }

  await page.goto("/sitemapper");
  await expect(page.getByRole("heading", { name: "Sitemaps", exact: true })).toBeVisible();
  // The Sitemap library became a `DataTable` in issue #165: the record is
  // reached through the name link, and its page count is a column of its own
  // rather than part of one button's accessible name.
  const sitemapRow = page
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: "Sample Studio sitemap", exact: true }) });
  await expect(sitemapRow).toHaveCount(1);
  await expect(sitemapRow.getByRole("cell").filter({ hasText: /^5$/ })).toHaveCount(1);
  expect(failures).toEqual([]);
});

test("crawls every emitted SiteProject route with refresh, Entry content, chrome, and internal links", async ({ page }) => {
  test.setTimeout(180_000);
  const failures = watchRuntimeFailures(page);
  for (const route of SITE_ROUTES) {
    failures.length = 0;
    const response = await page.goto(route);
    expect(response?.status(), `${route} direct navigation`).toBe(200);
    await expectRouteContent(page, route);
    await expectSiteChrome(page, route);
    await page.reload();
    await expectRouteContent(page, route);
    await expectSiteChrome(page, route);

    const hrefs = await page.locator('a[href^="/site"]').evaluateAll((anchors) => anchors.map((anchor) => {
      const href = anchor.getAttribute("href")!;
      return new URL(href, window.location.origin).pathname;
    }));
    const unique = [...new Set(hrefs)];
    expect(unique.every((href) => (SITE_ROUTES as readonly string[]).includes(href)), `${route} internal links`).toBe(true);
    for (const href of unique) expect((await page.request.get(href)).status(), `${route} -> ${href}`).toBe(200);
    expect(failures, `${route} runtime failures`).toEqual([]);
  }
});

test("an authoring Entry edit survives reload and is reflected by SiteDelivery", async ({ page }) => {
  test.skip(BROWSER_LANE !== "dev", "the production lane intentionally serves immutable bundled data");
  const failures = watchRuntimeFailures(page);
  await page.goto("/content");
  const contentTree = page.getByRole("tree", { name: "Content" });
  await contentTree.getByRole("treeitem", { name: /^About content/ }).click();
  await contentTree.getByRole("treeitem", { name: /^A studio built around useful clarity/ }).click();
  const heading = page.getByRole("textbox", { name: "Heading (required)" });
  await heading.fill("A browser-edited studio");
  await heading.blur();
  // The route publishes its save state through `useEditorStatus`; the shell
  // draws it in the topbar.
  await expect(page.locator(".cms-topbar__status")).toContainText("Saved");
  await page.goto("/site/about");
  await expect(page.getByRole("heading", { name: "A browser-edited studio", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "A browser-edited studio", exact: true })).toBeVisible();
  expect(failures).toEqual([]);
});

test("missing SiteProject routes show an accessible not-found state", async ({ page }) => {
  const failures = watchRuntimeFailures(page);
  const response = await page.goto("/site/does-not-exist");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Page not found", exact: true })).toBeVisible();
  await expect(page.getByText("This page is not present in the current Sitemap.", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toHaveCount(0);
  expect(failures).toEqual([]);
});

test("SiteDelivery remains usable at desktop and mobile widths in both themes", async ({ page }) => {
  const failures = watchRuntimeFailures(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/site/journal/map-the-moving-parts");
  for (const theme of ["light", "dark"] as const) {
    await useTheme(page, theme);
    await expect(page.locator(".site-delivery__main")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await expectNoHorizontalOverflow(page);
  const primary = page.getByRole("navigation", { name: "Primary navigation" });
  for (const link of await primary.getByRole("link").all()) {
    expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
  const brand = page.getByRole("link", { name: "Sample Studio", exact: true });
  await brand.focus();
  await expect(brand).toBeFocused();
  await expect(brand).toHaveCSS("outline-width", "2px");
  expect(failures).toEqual([]);
});

test("production ignores an alternate active disposable project and serves the bundled sample", async ({ page }) => {
  test.skip(BROWSER_LANE !== "dist", "the dev lane intentionally follows its activated disposable project");
  const failures = watchRuntimeFailures(page);
  const virtualResponses: Response[] = [];
  page.on("response", (response) => {
    if (response.url().includes("virtual:site-project-source") || response.url().includes("__x00__virtual")) virtualResponses.push(response);
  });
  await page.goto("/site");
  await expect(page.getByRole("link", { name: "Sample Studio", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Clear ideas, carefully shaped", exact: true })).toBeVisible();
  await expect(page.getByText("Disposable browser project", { exact: true })).toHaveCount(0);
  await expect.poll(() => virtualResponses.length).toBe(0);
  expect(failures).toEqual([]);
});

test("dev virtual source contains the CLI-activated project", async ({ page }) => {
  test.skip(BROWSER_LANE !== "dev", "the production bundle intentionally has no Vite virtual source request");
  const failures = watchRuntimeFailures(page);
  const virtualResponses: Response[] = [];
  page.on("response", (response) => {
    if (response.url().includes("virtual:site-project-source") || response.url().includes("__x00__virtual")) virtualResponses.push(response);
  });
  await page.goto("/site");
  await expect(page.getByRole("link", { name: "Sample Studio", exact: true })).toBeVisible();
  await expect.poll(() => virtualResponses.length).toBeGreaterThan(0);
  const source = await virtualResponses[0]!.text();
  expect(source).toContain('"sample-studio-site"');
  expect(source).toContain('"Sample Studio"');
  expect(failures).toEqual([]);
});
