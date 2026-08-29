/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import { act, renderHook } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSequentialIdFactory } from "../../../../shared";
import type { SitemapRecord } from "../../../../sitemapper/library";
import { useSitemapperController, type UseSitemapperControllerOptions } from "../use-sitemapper-controller";

function record(): SitemapRecord {
  return {
    id: "map",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    document: {
      schemaVersion: 2,
      id: "map",
      name: "Map",
      root: [{ id: "home", title: "Home", source: { kind: "unassigned" }, children: [{ id: "child", title: "Child", source: { kind: "unassigned" }, children: [] }] }],
    },
  };
}

function setup(write: NonNullable<UseSitemapperControllerOptions["write"]> = vi.fn(async () => undefined)) {
  return renderHook(() => useSitemapperController({
    record: record(),
    write,
    idFactory: createSequentialIdFactory("page"),
    now: () => "2026-02-01T00:00:00.000Z",
  }));
}

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
afterEach(() => vi.useRealTimers());

describe("useSitemapperController", () => {
  it("keeps dispatch stable across state-changing renders", () => {
    const { result } = setup();
    const dispatch = result.current.dispatch;
    act(() => { result.current.dispatch({ type: "select", pageId: "child" }); });
    expect(result.current.dispatch).toBe(dispatch);
  });

  it("flushes a pending patch before removal, so it cannot resurrect the removed page", () => {
    const { result } = setup();
    act(() => {
      result.current.updatePropsDebounced("child", { title: "Final title" });
      result.current.dispatch({ type: "remove", pageId: "child" });
    });
    expect(result.current.lastError).toBeNull();
    expect(result.current.state.document.root[0]!.children).toEqual([]);
    expect(result.current.queue.state.draft.document.root[0]!.children).toEqual([]);
  });

  it("surfaces dirty, saving, then saved while debouncing and persisting", async () => {
    let resolveWrite!: () => void;
    const write = vi.fn(() => new Promise<void>((resolve) => { resolveWrite = resolve; }));
    const { result } = setup(write);

    act(() => result.current.updatePropsDebounced("child", { title: "Typed" }));
    expect(result.current.state.saveStatus).toEqual({ kind: "dirty" });

    act(() => { result.current.flushPropUpdates(); });
    expect(result.current.state.saveStatus).toEqual({ kind: "saving" });
    await act(async () => {
      await Promise.resolve();
      resolveWrite();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.state.saveStatus).toEqual({ kind: "saved" });
  });

  it("restores the queue status when a debounced patch is a no-op", () => {
    const { result } = setup();
    act(() => result.current.updatePropsDebounced("child", { title: "Child" }));
    expect(result.current.state.saveStatus).toEqual({ kind: "dirty" });
    act(() => { result.current.flushPropUpdates(); });
    expect(result.current.state.saveStatus).toEqual({ kind: "saved" });
  });
});
