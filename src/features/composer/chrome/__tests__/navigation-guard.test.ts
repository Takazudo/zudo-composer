import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBeforeUnloadHandler,
  installComposerNavigationGuard,
} from "../navigation-guard";

describe("createBeforeUnloadHandler", () => {
  function mockEvent(): BeforeUnloadEvent {
    return { preventDefault: vi.fn(), returnValue: "" } as unknown as BeforeUnloadEvent;
  }

  it("arms the native prompt when there are unsaved edits", () => {
    const handler = createBeforeUnloadHandler(() => true);
    const event = mockEvent();
    const result = handler(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.returnValue).toBe("");
    expect(result).toBe("");
  });

  it("does nothing when everything is saved", () => {
    const handler = createBeforeUnloadHandler(() => false);
    const event = mockEvent();
    const result = handler(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });
});

describe("installComposerNavigationGuard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("installs and removes the native beforeunload listener", () => {
    const addWinSpy = vi.spyOn(window, "addEventListener");
    const removeWinSpy = vi.spyOn(window, "removeEventListener");

    const dispose = installComposerNavigationGuard(() => true);
    expect(addWinSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));

    dispose();
    expect(removeWinSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));
  });
});
