import { render, settle } from "../../../../test/render";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSequentialIdFactory } from "../../../../shared";
import type { SitemapRecord } from "../../../../sitemapper/library";
import { createSitemapperController, type SitemapperController, type UseSitemapperControllerOptions } from "../use-sitemapper-controller";
import type { ProductionProviderIntegration } from "../../../../app/provider-integration";
import { createWorkspaceSaveRegistry } from "../../../../app/workspace-sessions";

function record(): SitemapRecord {
  return {
    id: "map",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    document: {
      schemaVersion: 3, navigation: { primary: [], footer: [] },
      id: "map",
      name: "Map",
      root: [{ id: "home", title: "Home", source: { kind: "unassigned" }, children: [{ id: "child", title: "Child", source: { kind: "unassigned" }, children: [] }] }],
    },
  };
}

/** Creates the controller in a mounted component's setup, as an editor does; `unmount` ends its scope. */
function renderController(options: () => UseSitemapperControllerOptions) {
  const result: { current: SitemapperController } = { current: null as unknown as SitemapperController };
  function Probe() {
    result.current = createSitemapperController(options());
    return null;
  }
  const view = render(<Probe />);
  return { result, unmount: () => view.unmount() };
}

function setup(write: NonNullable<UseSitemapperControllerOptions["write"]> = vi.fn(async () => undefined)) {
  return renderController(() => ({
    record: record(),
    write,
    idFactory: createSequentialIdFactory("page"),
    now: () => "2026-02-01T00:00:00.000Z",
  }));
}

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
afterEach(() => vi.useRealTimers());

describe("createSitemapperController", () => {
  it("registers the real pending property debounce with the workspace save barrier", async () => {
    const sessions = createWorkspaceSaveRegistry(); const write = vi.fn(async () => undefined);
    const integration = { sessions, workspace: { id: "workspace" } } as unknown as ProductionProviderIntegration;
    const { result, unmount } = renderController(() => ({ record: record(), providerId: "sitemap-filesystem", write, integration }));
    result.current.updatePropsDebounced("home", { title: "Pending title" });
    expect(write).not.toHaveBeenCalled();
    expect((await sessions.flush()).status).toBe("ready");
    await settle();
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ record: expect.objectContaining({ document: expect.objectContaining({ root: expect.arrayContaining([expect.objectContaining({ title: "Pending title" })]) }) }) }));
    unmount(); expect((await sessions.flush()).status).toBe("ready");
  });
  it("keeps dispatch stable across state-changing renders", () => {
    const { result } = setup();
    const dispatch = result.current.dispatch;
    result.current.dispatch({ type: "select", pageId: "child" });
    expect(result.current.dispatch).toBe(dispatch);
  });

  it("flushes a pending patch before removal, so it cannot resurrect the removed page", () => {
    const { result } = setup();
    result.current.updatePropsDebounced("child", { title: "Final title" });
    result.current.dispatch({ type: "remove", pageId: "child" });
    expect(result.current.lastError).toBeNull();
    expect(result.current.state.document.root[0]!.children).toEqual([]);
    expect(result.current.queue.state.draft.document.root[0]!.children).toEqual([]);
  });

  it("surfaces dirty, saving, then saved while debouncing and persisting", async () => {
    let resolveWrite!: () => void;
    const write = vi.fn(() => new Promise<void>((resolve) => { resolveWrite = resolve; }));
    const { result } = setup(write);

    result.current.updatePropsDebounced("child", { title: "Typed" });
    expect(result.current.state.saveStatus).toEqual({ kind: "dirty" });

    result.current.flushPropUpdates();
    expect(result.current.state.saveStatus).toEqual({ kind: "saving" });
    await Promise.resolve();
    resolveWrite();
    await Promise.resolve();
    await Promise.resolve();
    await settle();
    expect(result.current.state.saveStatus).toEqual({ kind: "saved" });
  });

  it("restores the queue status when a debounced patch is a no-op", () => {
    const { result } = setup();
    result.current.updatePropsDebounced("child", { title: "Child" });
    expect(result.current.state.saveStatus).toEqual({ kind: "dirty" });
    result.current.flushPropUpdates();
    expect(result.current.state.saveStatus).toEqual({ kind: "saved" });
  });

  it("flushes focused navigation drafts through the workspace save session", async () => {
    const sessions = createWorkspaceSaveRegistry();
    const write = vi.fn(async () => undefined);
    const integration = { sessions, workspace: { id: "workspace" } } as unknown as ProductionProviderIntegration;
    const value = record();
    value.document.navigation.primary = [{ id: "home-link", label: "Home", visible: true, destination: { kind: "route", nodeId: "home" } }];
    const { result, unmount } = renderController(() => ({ record: value, providerId: "sitemap-filesystem", write, integration }));
    result.current.updateNavigationDebounced("primary", "home-link", { label: "Start" });
    expect(write).not.toHaveBeenCalled();
    expect((await sessions.flush()).status).toBe("ready");
    await settle();
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ record: expect.objectContaining({ document: expect.objectContaining({ navigation: { primary: [expect.objectContaining({ label: "Start" })], footer: [] } }) }) }));
    unmount();
  });

  it("keeps an invalid focused navigation draft for correction instead of losing it", () => {
    const value = record();
    value.document.navigation.primary = [{ id: "home-link", label: "Home", visible: true, destination: { kind: "route", nodeId: "home" } }];
    const { result } = renderController(() => ({ record: value, write: vi.fn(async () => undefined) }));
    result.current.updateNavigationDebounced("primary", "home-link", { label: "" });
    expect(result.current.flushNavigationDrafts()).toMatch(/Navigation/);
    result.current.updateNavigationDebounced("primary", "home-link", { label: "Corrected" });
    expect(result.current.flushNavigationDrafts()).toBeNull();
    expect(result.current.state.document.navigation.primary[0]?.label).toBe("Corrected");
  });

  it("blocks later actions while an invalid navigation draft remains pending", () => {
    const value = record();
    value.document.navigation.primary = [{ id: "home-link", label: "Home", visible: true, destination: { kind: "route", nodeId: "home" } }];
    const { result } = renderController(() => ({ record: value, write: vi.fn(async () => undefined) }));
    result.current.updateNavigationDebounced("primary", "home-link", { label: "" });
    const error = result.current.dispatch({ type: "rename", name: "Blocked" });
    expect(error).toMatch(/Navigation/);
    expect(result.current.state.document.name).toBe("Map");
    result.current.updateNavigationDebounced("primary", "home-link", { label: "Home page" });
    result.current.flushNavigationDrafts();
    result.current.dispatch({ type: "rename", name: "Allowed" });
    expect(result.current.state.document.name).toBe("Allowed");
  });

  it("invalidates remove undo after a successful navigation draft flush", () => {
    const value = record();
    value.document.navigation.primary = [{ id: "home-link", label: "Home", visible: true, destination: { kind: "route", nodeId: "home" } }];
    const { result } = renderController(() => ({ record: value, write: vi.fn(async () => undefined) }));
    result.current.dispatch({ type: "remove", pageId: "child" });
    expect(result.current.canUndoRemove).toBe(true);
    result.current.updateNavigationDebounced("primary", "home-link", { label: "Start" });
    result.current.flushNavigationDrafts();
    expect(result.current.canUndoRemove).toBe(false);
    expect(result.current.undoRemove()).toBeNull();
    expect(result.current.state.document.root[0]!.children).toEqual([]);
  });

  it("restores an exact removed subtree only before another mutation", () => {
    const { result } = setup();
    result.current.dispatch({ type: "remove", pageId: "child" });
    expect(result.current.canUndoRemove).toBe(true);
    result.current.undoRemove();
    expect(result.current.state.document.root[0]!.children).toEqual([
      { id: "child", title: "Child", source: { kind: "unassigned" }, children: [] },
    ]);
    expect(result.current.canUndoRemove).toBe(false);

    result.current.dispatch({ type: "remove", pageId: "child" });
    result.current.dispatch({ type: "rename", name: "Changed" });
    expect(result.current.canUndoRemove).toBe(false);
    expect(result.current.undoRemove()).toBeNull();
    expect(result.current.state.document.root[0]!.children).toEqual([]);
  });
});
