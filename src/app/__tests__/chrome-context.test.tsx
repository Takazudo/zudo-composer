import { cleanup, render, screen } from "@testing-library/preact";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChromeContext,
  createChromeStore,
  EMPTY_CHROME_SNAPSHOT,
  useBreadcrumb,
  useChrome,
  useEditorStatus,
  type BreadcrumbItem,
  type EditorStatus,
} from "../chrome-context";

afterEach(cleanup);

function ChromeProbe() {
  const { breadcrumb, editorStatus } = useChrome();
  return (
    <div>
      <p data-testid="crumbs">{breadcrumb.map((item) => `${item.label}${item.href ? `@${item.href}` : ""}`).join(" / ")}</p>
      <p data-testid="status">{editorStatus ? `${editorStatus.state}${editorStatus.detail ? `: ${editorStatus.detail}` : ""}` : "none"}</p>
      {editorStatus?.onRetry ? <button onClick={editorStatus.onRetry}>Retry</button> : null}
    </div>
  );
}

function BreadcrumbRoute({ items }: { items: readonly BreadcrumbItem[] }) {
  useBreadcrumb(items);
  return null;
}

function StatusRoute({ status }: { status: EditorStatus | null }) {
  useEditorStatus(status);
  return null;
}

function withStore(children: ComponentChildren, store = createChromeStore()) {
  return { store, ui: <ChromeContext.Provider value={store}>{children}</ChromeContext.Provider> };
}

describe("chrome store", () => {
  it("starts empty and notifies subscribers only when the published value changes", () => {
    const store = createChromeStore();
    const owner = {};
    const listener = vi.fn();
    expect(store.getSnapshot()).toEqual(EMPTY_CHROME_SNAPSHOT);
    store.subscribe(listener);

    store.publishBreadcrumb(owner, [{ label: "Content" }]);
    expect(listener).toHaveBeenCalledTimes(1);
    store.publishBreadcrumb(owner, [{ label: "Content" }]);
    expect(listener).toHaveBeenCalledTimes(1);
    store.publishBreadcrumb(owner, [{ label: "Content", href: "/content" }]);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().breadcrumb).toEqual([{ label: "Content", href: "/content" }]);
  });

  it("keeps a republished retry callback current without reporting a change", () => {
    const store = createChromeStore();
    const owner = {};
    const listener = vi.fn();
    store.subscribe(listener);
    const first = vi.fn();
    const second = vi.fn();

    store.publishEditorStatus(owner, { state: "failed", detail: "Saving failed.", onRetry: first });
    expect(listener).toHaveBeenCalledTimes(1);
    store.publishEditorStatus(owner, { state: "failed", detail: "Saving failed.", onRetry: second });
    expect(listener).toHaveBeenCalledTimes(1);

    store.getSnapshot().editorStatus?.onRetry?.();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("reports gaining and losing the retry affordance", () => {
    const store = createChromeStore();
    const owner = {};
    const listener = vi.fn();
    store.subscribe(listener);
    store.publishEditorStatus(owner, { state: "failed" });
    store.publishEditorStatus(owner, { state: "failed", onRetry: vi.fn() });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().editorStatus?.onRetry).toBeTypeOf("function");
  });

  it("only lets the current owner release a slot", () => {
    const store = createChromeStore();
    const stale = {};
    const current = {};
    store.publishBreadcrumb(stale, [{ label: "Old" }]);
    store.publishBreadcrumb(current, [{ label: "New" }]);
    store.releaseBreadcrumb(stale);
    expect(store.getSnapshot().breadcrumb).toEqual([{ label: "New" }]);
    store.releaseBreadcrumb(current);
    expect(store.getSnapshot().breadcrumb).toEqual([]);
  });

  it("drops a subscriber after it unsubscribes", () => {
    const store = createChromeStore();
    const listener = vi.fn();
    store.subscribe(listener)();
    store.publishBreadcrumb({}, [{ label: "Content" }]);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("chrome hooks", () => {
  it("renders what a route publishes and clears it when the route unmounts", () => {
    function Harness({ mounted }: { mounted: boolean }) {
      return (
        <>
          <ChromeProbe />
          {mounted ? <BreadcrumbRoute items={[{ label: "Content", href: "/content" }, { label: "Journal articles" }]} /> : null}
        </>
      );
    }
    const { store, ui } = withStore(<Harness mounted />);
    const { rerender } = render(ui);
    expect(screen.getByTestId("crumbs")).toHaveTextContent("Content@/content / Journal articles");

    rerender(<ChromeContext.Provider value={store}><Harness mounted={false} /></ChromeContext.Provider>);
    expect(screen.getByTestId("crumbs")).toHaveTextContent("");
  });

  it("republishes an inline literal on every render without looping the chrome", () => {
    let renders = 0;
    function CountingProbe() {
      renders += 1;
      return <ChromeProbe />;
    }
    function Route() {
      const [, setTick] = useState(0);
      useBreadcrumb([{ label: "Composer" }]);
      return <button onClick={() => setTick((value) => value + 1)}>tick</button>;
    }
    const { ui } = withStore(<><CountingProbe /><Route /></>);
    render(ui);
    expect(screen.getByTestId("crumbs")).toHaveTextContent("Composer");
    const afterFirstPublish = renders;
    screen.getByRole("button", { name: "tick" }).click();
    expect(renders).toBe(afterFirstPublish);
  });

  it("publishes editor status and wires the retry affordance to the newest callback", () => {
    const retry = vi.fn();
    const { store, ui } = withStore(<><ChromeProbe /><StatusRoute status={{ state: "failed", detail: "Saving failed.", onRetry: retry }} /></>);
    const { rerender } = render(ui);
    expect(screen.getByTestId("status")).toHaveTextContent("failed: Saving failed.");
    screen.getByRole("button", { name: "Retry" }).click();
    expect(retry).toHaveBeenCalledTimes(1);

    rerender(<ChromeContext.Provider value={store}><ChromeProbe /><StatusRoute status={{ state: "saved" }} /></ChromeContext.Provider>);
    expect(screen.getByTestId("status")).toHaveTextContent("saved");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("stays inert without a provider", () => {
    render(<><ChromeProbe /><BreadcrumbRoute items={[{ label: "Content" }]} /><StatusRoute status={{ state: "saving" }} /></>);
    expect(screen.getByTestId("crumbs")).toHaveTextContent("");
    expect(screen.getByTestId("status")).toHaveTextContent("none");
  });
});
