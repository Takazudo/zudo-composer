import { computed, getScope, Show, signal, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, settle } from "../../test/render";
import {
  bindBreadcrumb,
  bindEditorStatus,
  chromeSnapshot,
  createChromeStore,
  EMPTY_CHROME_SNAPSHOT,
  type BreadcrumbItem,
  type ChromeStore,
  type EditorStatus,
} from "../chrome-context";

function ChromeProbe({ store, onRender }: { store: ChromeStore | null; onRender?: () => void }) {
  const snapshot = chromeSnapshot(getScope(), store);
  const crumbs = computed(() => {
    onRender?.();
    return snapshot.value.breadcrumb.map((item) => `${item.label}${item.href ? `@${item.href}` : ""}`).join(" / ");
  });
  const status = computed(() => {
    const editorStatus = snapshot.value.editorStatus;
    return editorStatus ? `${editorStatus.state}${editorStatus.detail ? `: ${editorStatus.detail}` : ""}` : "none";
  });
  const hasRetry = computed(() => snapshot.value.editorStatus?.onRetry !== undefined);
  return (
    <div>
      <p data-testid="crumbs">{crumbs}</p>
      <p data-testid="status">{status}</p>
      <Show when={hasRetry}>{() => <button on:click={() => snapshot.value.editorStatus?.onRetry?.()}>Retry</button>}</Show>
    </div>
  );
}

function BreadcrumbRoute({ store, items }: { store: ChromeStore | null; items: readonly BreadcrumbItem[] | ReadonlySignal<readonly BreadcrumbItem[]> }) {
  bindBreadcrumb(getScope(), store, items);
  return null;
}

function StatusRoute({ store, status }: { store: ChromeStore | null; status: EditorStatus | null | ReadonlySignal<EditorStatus | null> }) {
  bindEditorStatus(getScope(), store, status);
  return null;
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

describe("chrome bindings", () => {
  it("renders what a route publishes and clears it when the route unmounts", async () => {
    const store = createChromeStore();
    const mounted = signal(true);
    render(
      <>
        <ChromeProbe store={store} />
        <Show when={mounted}>{() => <BreadcrumbRoute store={store} items={[{ label: "Content", href: "/content" }, { label: "Journal articles" }]} />}</Show>
      </>,
    );
    await settle();
    expect(screen.getByTestId("crumbs")).toHaveTextContent("Content@/content / Journal articles");

    mounted.value = false;
    await settle();
    expect(screen.getByTestId("crumbs")).toHaveTextContent("");
  });

  it("republishes an equal trail on every change without re-rendering the chrome", async () => {
    let renders = 0;
    const store = createChromeStore();
    function Route() {
      const tick = signal(0);
      // A fresh but equal literal for every tick, as an inline trail produces.
      bindBreadcrumb(getScope(), store, computed(() => (tick.value, [{ label: "Composer" }])));
      return (
        <button
          on:click={() => {
            tick.value += 1;
          }}
        >
          tick
        </button>
      );
    }
    render(<><ChromeProbe
          store={store}
          onRender={() => {
            renders += 1;
          }}
        /><Route /></>);
    await settle();
    expect(screen.getByTestId("crumbs")).toHaveTextContent("Composer");
    const afterFirstPublish = renders;
    screen.getByRole("button", { name: "tick" }).click();
    await settle();
    expect(renders).toBe(afterFirstPublish);
  });

  it("publishes editor status and wires the retry affordance to the newest callback", async () => {
    const retry = vi.fn();
    const store = createChromeStore();
    const status = signal<EditorStatus | null>({ state: "failed", detail: "Saving failed.", onRetry: retry });
    render(<><ChromeProbe store={store} /><StatusRoute store={store} status={status} /></>);
    await settle();
    expect(screen.getByTestId("status")).toHaveTextContent("failed: Saving failed.");
    screen.getByRole("button", { name: "Retry" }).click();
    expect(retry).toHaveBeenCalledTimes(1);

    status.value = { state: "saved" };
    await settle();
    expect(screen.getByTestId("status")).toHaveTextContent("saved");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("stays inert without a store", async () => {
    render(<><ChromeProbe store={null} /><BreadcrumbRoute store={null} items={[{ label: "Content" }]} /><StatusRoute store={null} status={{ state: "saving" }} /></>);
    await settle();
    expect(screen.getByTestId("crumbs")).toHaveTextContent("");
    expect(screen.getByTestId("status")).toHaveTextContent("none");
  });
});


