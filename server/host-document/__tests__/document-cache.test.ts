import { expect, it } from "vitest";
import { createHostDocumentCache } from "../document-cache";
it("serves only exact issued immutable documents and bounds their lifetime/count", () => {
  let time = 0;
  const cache = createHostDocumentCache({ limit: 2, lifetimeMs: 10, now: () => time });
  const first = cache.put("first"), second = cache.put("second");
  expect(first).toMatch(/^\/\?__zudo_host_document=[a-f0-9]{64}$/);
  expect(cache.get(first)).toBe("first"); expect(cache.get(`${first}?other`)).toBeUndefined();
  cache.put("third"); expect(cache.get(first)).toBeUndefined(); expect(cache.get(second)).toBe("second");
  const route = cache.put("exact visitor", "/contact/?course=stable-id#inquiry");
  expect(route).toMatch(/^\/contact\/\?course=stable-id&__zudo_host_document=[a-f0-9]{64}#inquiry$/);
  expect(cache.get(route.split("#")[0]!)).toBe("exact visitor");
  expect(cache.get(route.replace("/contact/", "/lessons/").split("#")[0]!)).toBeUndefined();
  time = 10; expect(cache.get(route.split("#")[0]!)).toBeUndefined();
});
