import { expect, type Page } from "@playwright/test";

/** One provider RPC: the file-provider endpoint path and its operation header. */
export interface ProviderRequest { endpoint: string; operation: string }
export type RequestTally = Record<string, number>;

function tally(requests: readonly ProviderRequest[]): RequestTally {
  const counts: RequestTally = {};
  for (const { endpoint, operation } of requests) { const key = `${endpoint.replace(/^\/__zudo_composer_/, "")}:${operation}`; counts[key] = (counts[key] ?? 0) + 1; }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Loads an authoring route cold and records every same-origin provider POST
 * until the network has been quiet for `quietMs`. Ordinary image GETs and
 * Vite module requests are not provider RPCs and are not counted.
 */
export async function measureProviderRequests(page: Page, route: string, ready: (page: Page) => Promise<void>, quietMs = 1_500): Promise<RequestTally> {
  const requests: ProviderRequest[] = [];
  let last = Date.now();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() !== "POST" || !url.pathname.startsWith("/__zudo_composer_")) return;
    requests.push({ endpoint: url.pathname, operation: request.headers()["x-zudo-composer-operation"] ?? request.headers()["x-zudo-composer-asset-operation"] ?? "" });
    last = Date.now();
  });
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await ready(page);
  await expect.poll(() => Date.now() - last >= quietMs, { timeout: 30_000, intervals: [250] }).toBe(true);
  return tally(requests);
}
