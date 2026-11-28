import { afterEach, expect, it, vi } from "vitest";
vi.mock("virtual:composer-file-provider-config", () => ({ fileProviderConfig: { nativeEditing: { hostDocument: true } } }));
// A regression importing the old runtime must fail before any component can run.
vi.mock("../visitor-entry", () => { throw new Error("Incompatible visitor runtime was imported"); });
afterEach(() => { document.body.innerHTML = ""; window.history.replaceState(null, "", "/"); vi.resetModules(); });
it.each(["/site/notes/example", "/website-preview/lessons"])("guards direct %s before importing the visitor delivery runtime", async pathname => {
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState(null, "", pathname);
  await import("../../../main");
  expect(document.querySelector("h1")?.textContent).toBe(pathname.startsWith("/site/") ? "Activated release preview unavailable" : "Use the saved host page preview");
});
