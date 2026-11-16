import { expect, it } from "vitest";
import { canonicalHostRoute } from "../../../shared/host-route";
import { knownVisitorUrl } from "../protocol";
it("resolves only captured directory slash aliases without rewriting the visitor URL", () => {
  const paths = ["/", "/lessons", "/contact", "/404.html"];
  expect(canonicalHostRoute("/lessons/", paths)).toBe("/lessons");
  expect(knownVisitorUrl("/lessons/", "https://host.test", paths)).toBe("/lessons/");
  expect(knownVisitorUrl("/contact/?course=1#inquiry", "https://host.test", paths)).toBe("/contact/?course=1#inquiry");
  for (const path of ["/unknown/", "/lessons//", "/404.html/", "//"]) expect(canonicalHostRoute(path, paths)).toBeNull();
  expect(canonicalHostRoute("/lessons", ["/lessons/"])).toBe("/lessons/");
  expect(canonicalHostRoute("/lessons/", ["/lessons", "/lessons/"])).toBe("/lessons/");
  expect(knownVisitorUrl("//foreign.test/contact/?course=1", "https://host.test", paths)).toBeNull();
});
