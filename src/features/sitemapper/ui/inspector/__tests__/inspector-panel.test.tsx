/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import { useState } from "preact/hooks";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CatalogEntry, CompositionCatalog } from "../../../../../sitemapper/catalog";
import type { CompositionRef, SitemapDocument, SitemapNode } from "../../../../../sitemapper/model";
import { SITEMAP_SCHEMA_VERSION } from "../../../../../sitemapper/model";
import { InspectorPanel } from "../inspector-panel";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };
});
afterEach(cleanup);

const FIRST: CatalogEntry = {
  ref: { providerId: "browser", recordId: "home-layout" },
  providerLabel: "This browser",
  name: "Home layout",
  updatedAt: "2026-08-28T01:00:00.000Z",
  nodeCount: 4,
};

const SECOND: CatalogEntry = {
  ref: { providerId: "files", recordId: "other-layout" },
  providerLabel: "Project files",
  name: "Other layout",
  updatedAt: "2026-08-28T02:00:00.000Z",
  nodeCount: 2,
};

function node(id = "home", title = "Home", composition?: CompositionRef): SitemapNode {
  return {
    id,
    title,
    slug: "",
    notes: "Start here",
    source: composition ? { kind: "composition", ref: composition } : { kind: "unassigned" },
    children: [],
  };
}

function documentOf(...nodes: SitemapNode[]): SitemapDocument {
  return { schemaVersion: SITEMAP_SCHEMA_VERSION, id: "inspector-test", name: "Inspector test", root: nodes };
}

function resolvedRecord(entry: CatalogEntry) {
  return {
    id: entry.ref.recordId,
    createdAt: entry.updatedAt,
    updatedAt: entry.updatedAt,
    document: { schemaVersion: 2, id: entry.ref.recordId, name: entry.name, root: [] },
  };
}

function catalog(entries: CatalogEntry[] = [FIRST, SECOND]): CompositionCatalog {
  return {
    listCompositions: vi.fn(async () => ({ entries, failures: [] })),
    resolveComposition: vi.fn(async (ref) => {
      const entry = entries.find((candidate) => candidate.ref.providerId === ref.providerId
        && candidate.ref.recordId === ref.recordId);
      return entry
        ? { status: "resolved" as const, record: resolvedRecord(entry) }
        : { status: "not-found" as const };
    }),
  } as CompositionCatalog;
}

function panelProps(selected: SitemapNode, overrides: Record<string, unknown> = {}) {
  return {
    document: documentOf(selected),
    node: selected,
    routes: new Map([[selected.id, "/"]]),
    catalog: catalog(),
    onUpdatePropsDebounced: vi.fn(),
    onUpdateSource: vi.fn(),
    onReparent: vi.fn(),
    onDelete: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides,
  };
}

/** The Source tab is behind the pane tablist. */
function openSourceTab(): void {
  fireEvent.click(screen.getByRole("tab", { name: "Source" }));
}

describe("Sitemapper InspectorPanel", () => {
  it("renders controlled title, slug, and notes on the debounced channel and flushes on blur", () => {
    const onUpdatePropsDebounced = vi.fn();
    const onFlushPropUpdates = vi.fn();
    render(<InspectorPanel {...panelProps(node(), { onUpdatePropsDebounced, onFlushPropUpdates })} />);

    fireEvent.input(screen.getByLabelText("Title"), { target: { value: "Welcome" } });
    fireEvent.input(screen.getByLabelText("Slug"), { target: { value: "welcome" } });
    fireEvent.input(screen.getByLabelText("Notes"), { target: { value: "Landing page" } });
    fireEvent.blur(screen.getByLabelText("Notes"));

    expect(onUpdatePropsDebounced.mock.calls).toEqual([
      ["home", { title: "Welcome" }],
      ["home", { slug: "welcome" }],
      ["home", { notes: "Landing page" }],
    ]);
    expect(onFlushPropUpdates).toHaveBeenCalledOnce();
  });

  it("shows the page's full route beside the slug field", () => {
    const about = node("about", "About");
    render(<InspectorPanel {...panelProps(about, { routes: new Map([["about", "/about"]]) })} />);
    expect(screen.getByText("/about")).toBeInTheDocument();
  });

  it("retains a focused draft across rerenders and remounts it when selection changes", () => {
    const first = node("a", "Alpha");
    const props = panelProps(first);
    const view = render(<InspectorPanel {...props} />);
    const input = screen.getByLabelText("Title") as HTMLInputElement;
    input.focus();
    fireEvent.input(input, { target: { value: "Alpha draft" } });

    // The focused guard prevents an external/stale value from clobbering the
    // local draft and caret on a normal rerender.
    view.rerender(<InspectorPanel {...props} node={{ ...first, title: "Alpha from storage" }} />);
    expect(screen.getByLabelText("Title")).toBe(input);
    expect(input).toHaveValue("Alpha draft");

    // The page:prop key is the other half: switching selection must discard
    // that focused draft even though the same field component remains.
    const second = node("b", "Beta");
    view.rerender(<InspectorPanel {...panelProps(second)} />);
    expect(screen.getByLabelText("Title")).not.toBe(input);
    expect(screen.getByLabelText("Title")).toHaveValue("Beta");
  });

  it("renders the unassigned, resolved, and broken reference states explicitly", async () => {
    const view = render(<InspectorPanel {...panelProps(node("home", "Home", FIRST.ref))} />);
    openSourceTab();
    expect(await screen.findByText("Home layout")).toBeInTheDocument();
    expect(screen.getByText("This browser")).toBeInTheDocument();

    const missing = { providerId: "files", recordId: "deleted-record" };
    view.rerender(<InspectorPanel {...panelProps(node("home", "Home", missing))} />);
    openSourceTab();
    expect(await screen.findByText("Broken reference")).toBeInTheDocument();
    expect(screen.getByText("files:deleted-record")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change…" })).toBeInTheDocument();

    view.rerender(<InspectorPanel {...panelProps(node())} />);
    openSourceTab();
    expect(screen.getByText("This page renders nothing until a source is assigned.")).toBeInTheDocument();
  });

  it("keeps a resolved reference usable when catalog listing unexpectedly rejects", async () => {
    const fakeCatalog = catalog([FIRST]);
    vi.mocked(fakeCatalog.listCompositions).mockRejectedValue(new Error("List unavailable"));
    render(<InspectorPanel {...panelProps(node("home", "Home", FIRST.ref), { catalog: fakeCatalog })} />);
    openSourceTab();

    expect(await screen.findByText("Home layout")).toBeInTheDocument();
    expect(screen.queryByText("Broken reference")).not.toBeInTheDocument();
    // Provider id is the honest fallback when its display label cannot load.
    expect(screen.getByText("browser")).toBeInTheDocument();
  });

  it("makes the page source an explicit None / Composition / Mapping choice", () => {
    const onConfirm = vi.fn();
    render(<InspectorPanel {...panelProps(node(), { onConfirm })} />);
    openSourceTab();

    const group = screen.getByRole("radiogroup", { name: "Page source type" });
    expect(within(group).getAllByRole("radio")).toHaveLength(3);
    expect(within(group).getByRole("radio", { name: "None" })).toHaveAttribute("aria-checked", "true");

    // Nothing is assigned yet, so choosing a kind asks nothing and clears nothing.
    fireEvent.click(within(group).getByRole("radio", { name: "Composition" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Choose composition…" })).toBeInTheDocument();
  });

  it("confirms before switching away from an assigned source, then clears it", () => {
    const onConfirm = vi.fn();
    const onUpdateSource = vi.fn();
    render(<InspectorPanel {...panelProps(node("home", "Home", FIRST.ref), { onConfirm, onUpdateSource })} />);
    openSourceTab();

    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Page source type" })).getByRole("radio", { name: "None" }));
    expect(onUpdateSource).not.toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalledOnce();

    const request = onConfirm.mock.calls[0]![0] as { title: string; onConfirm: () => void };
    expect(request.title).toBe("Clear the assigned composition?");
    request.onConfirm();
    expect(onUpdateSource).toHaveBeenCalledWith("home", { kind: "unassigned" });
  });

  it("round-trips assign, replace, and clear through the controlled callback", async () => {
    const changes: Array<CompositionRef | null> = [];
    const fakeCatalog = catalog();
    function Harness() {
      const [selected, setSelected] = useState<SitemapNode>(node());
      return (
        <InspectorPanel
          document={documentOf(selected)}
          node={selected}
          routes={new Map([["home", "/"]])}
          catalog={fakeCatalog}
          onUpdatePropsDebounced={() => {}}
          onReparent={() => {}}
          onDelete={() => {}}
          onConfirm={(request) => request.onConfirm()}
          onUpdateSource={(_id, source) => {
            const composition = source.kind === "composition" ? source.ref : null;
            changes.push(composition);
            setSelected((current) => ({ ...current, source }));
          }}
        />
      );
    }
    render(<Harness />);
    openSourceTab();

    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Page source type" })).getByRole("radio", { name: "Composition" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose composition…" }));
    let dialog = await screen.findByRole("dialog", { name: "Choose a composition" });
    fireEvent.click(within(dialog).getByRole("button", { name: /Assign Home layout/ }));
    expect(await screen.findByText("Home layout")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Change composition" }));
    dialog = await screen.findByRole("dialog", { name: "Choose a composition" });
    fireEvent.click(within(dialog).getByRole("button", { name: /Replace Other layout/ }));
    expect(await screen.findByText("Other layout")).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Page source type" })).getByRole("radio", { name: "None" }));
    expect(changes).toEqual([FIRST.ref, SECOND.ref, null]);
  });

  it("offers Delete page only below the root, and says what goes with it", () => {
    const child = node("child", "Child");
    const root = { ...node(), children: [child] };
    const onDelete = vi.fn();
    const view = render(<InspectorPanel {...panelProps(root, { document: documentOf(root), onDelete })} />);
    openSourceTab();
    expect(screen.getByRole("button", { name: "Delete page…" })).toBeDisabled();
    expect(screen.getByText("The root page cannot be deleted.")).toBeInTheDocument();

    view.rerender(<InspectorPanel {...panelProps(child, { document: documentOf(root), node: child, onDelete })} />);
    openSourceTab();
    fireEvent.click(screen.getByRole("button", { name: "Delete page…" }));
    expect(onDelete).toHaveBeenCalledWith("child");
  });
});
