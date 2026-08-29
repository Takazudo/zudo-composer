import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BEFORE_NAVIGATE_EVENT,
  createBeforeNavigateHandler,
  createBeforeUnloadHandler,
  installSitemapperNavigationGuard,
} from "../navigation-guard";

describe("Sitemapper navigation guard", () => {
  it("prevents SPA preparation while the predicate says the sitemap is dirty", () => {
    const handler = createBeforeNavigateHandler(() => true);
    const event = { preventDefault: vi.fn() };
    handler(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it("leaves SPA preparation untouched when the sitemap is saved", () => {
    const handler = createBeforeNavigateHandler(() => false);
    const event = { preventDefault: vi.fn() };
    handler(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("arms the native prompt only while the predicate is dirty", () => {
    const preventDefault = vi.fn();
    const dirty = createBeforeUnloadHandler(() => true);
    const dirtyEvent = { preventDefault, returnValue: "" } as unknown as BeforeUnloadEvent;
    expect(dirty(dirtyEvent)).toBe("");
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(dirtyEvent.returnValue).toBe("");

    preventDefault.mockClear();
    const clean = createBeforeUnloadHandler(() => false);
    const cleanEvent = { preventDefault, returnValue: "" } as unknown as BeforeUnloadEvent;
    expect(clean(cleanEvent)).toBeUndefined();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  describe("installSitemapperNavigationGuard", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("wires the cancelable preparation and native beforeunload listeners", () => {
      let dirty = true;
      const dispose = installSitemapperNavigationGuard(() => dirty);

      const blocked = !document.dispatchEvent(new Event(BEFORE_NAVIGATE_EVENT, { cancelable: true }));
      expect(blocked).toBe(true);
      dirty = false;
      const allowed = !document.dispatchEvent(new Event(BEFORE_NAVIGATE_EVENT, { cancelable: true }));
      expect(allowed).toBe(false);
      dispose();
    });

    it("disposer removes both listeners", () => {
      const addDoc = vi.spyOn(document, "addEventListener");
      const removeDoc = vi.spyOn(document, "removeEventListener");
      const addWindow = vi.spyOn(window, "addEventListener");
      const removeWindow = vi.spyOn(window, "removeEventListener");
      const dispose = installSitemapperNavigationGuard(() => true);

      expect(addDoc).toHaveBeenCalledWith(BEFORE_NAVIGATE_EVENT, expect.any(Function));
      expect(addWindow).toHaveBeenCalledWith("beforeunload", expect.any(Function));
      dispose();
      expect(removeDoc).toHaveBeenCalledWith(BEFORE_NAVIGATE_EVENT, expect.any(Function));
      expect(removeWindow).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    });
  });
});
