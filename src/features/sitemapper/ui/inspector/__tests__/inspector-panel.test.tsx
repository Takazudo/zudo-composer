/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import { useState } from "preact/hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogEntry, CompositionCatalog } from "../../../../../sitemapper/catalog";
import type { CompositionRef, SitemapNode } from "../../../../../sitemapper/model";
import { InspectorPanel } from "../inspector-panel";

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
  return { id, title, slug: "/", notes: "Start here", children: [], ...(composition ? { composition } : {}) };
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

function panelProps(selected: SitemapNode, overrides = {}) {
  return {
    selectedId: selected.id,
    node: selected,
    catalog: catalog(),
    onUpdatePropsDebounced: vi.fn(),
    onUpdateComposition: vi.fn(),
    ...overrides,
  };
}

describe("Sitemapper InspectorPanel", () => {
  it("renders controlled title, slug, and notes on the debounced channel and flushes on blur", () => {
    const onUpdatePropsDebounced = vi.fn();
    const onFlushPropUpdates = vi.fn();
    render(<InspectorPanel {...panelProps(node(), { onUpdatePropsDebounced, onFlushPropUpdates })} />);

    fireEvent.input(screen.getByLabelText("Title"), { target: { value: "Welcome" } });
    fireEvent.input(screen.getByLabelText("Slug"), { target: { value: "/welcome" } });
    fireEvent.input(screen.getByLabelText("Notes"), { target: { value: "Landing page" } });
    fireEvent.blur(screen.getByLabelText("Notes"));

    expect(onUpdatePropsDebounced.mock.calls).toEqual([
      ["home", { title: "Welcome" }],
      ["home", { slug: "/welcome" }],
      ["home", { notes: "Landing page" }],
    ]);
    expect(onFlushPropUpdates).toHaveBeenCalledOnce();
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

    // The selectedId:prop key is the other half: switching selection must
    // discard that focused draft even though the same field component remains.
    const second = node("b", "Beta");
    view.rerender(<InspectorPanel {...props} selectedId="b" node={second} />);
    expect(screen.getByLabelText("Title")).not.toBe(input);
    expect(screen.getByLabelText("Title")).toHaveValue("Beta");
  });

  it("renders the unassigned, resolved, and broken reference states explicitly", async () => {
    const view = render(<InspectorPanel {...panelProps(node())} />);
    expect(screen.getByText("No composition assigned.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose composition" })).toBeInTheDocument();

    view.rerender(<InspectorPanel {...panelProps(node("home", "Home", FIRST.ref))} />);
    expect(await screen.findByText("Home layout")).toBeInTheDocument();
    expect(screen.getByText("This browser")).toBeInTheDocument();

    const missing = { providerId: "files", recordId: "deleted-record" };
    view.rerender(<InspectorPanel {...panelProps(node("home", "Home", missing))} />);
    expect(await screen.findByText("Broken reference")).toBeInTheDocument();
    expect(screen.getByText("Raw reference")).toBeInTheDocument();
    expect(screen.getByText("files:deleted-record")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace composition" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear composition" })).toBeInTheDocument();
  });

  it("keeps a resolved reference usable when catalog listing unexpectedly rejects", async () => {
    const fakeCatalog = catalog([FIRST]);
    vi.mocked(fakeCatalog.listCompositions).mockRejectedValue(new Error("List unavailable"));
    render(<InspectorPanel {...panelProps(node("home", "Home", FIRST.ref), { catalog: fakeCatalog })} />);

    expect(await screen.findByText("Home layout")).toBeInTheDocument();
    expect(screen.queryByText("Broken reference")).not.toBeInTheDocument();
    // Provider id is the honest fallback when its display label cannot load.
    expect(screen.getByText("browser")).toBeInTheDocument();
  });

  it("round-trips assign, replace, and clear through the controlled callback", async () => {
    const changes: Array<CompositionRef | null> = [];
    const fakeCatalog = catalog();
    function Harness() {
      const [selected, setSelected] = useState<SitemapNode>(node());
      return (
        <InspectorPanel
          selectedId={selected.id}
          node={selected}
          catalog={fakeCatalog}
          onUpdatePropsDebounced={() => {}}
          onUpdateComposition={(_id, composition) => {
            changes.push(composition);
            setSelected((current) => {
              if (!composition) {
                const next = { ...current };
                delete next.composition;
                return next;
              }
              return { ...current, composition };
            });
          }}
        />
      );
    }
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Choose composition" }));
    let dialog = await screen.findByRole("dialog", { name: "Choose a composition" });
    fireEvent.click(within(dialog).getByRole("button", { name: /Assign Home layout/ }));
    expect(await screen.findByText("Home layout")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Replace composition" }));
    dialog = await screen.findByRole("dialog", { name: "Choose a composition" });
    fireEvent.click(within(dialog).getByRole("button", { name: /Replace Other layout/ }));
    expect(await screen.findByText("Other layout")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear composition" }));
    expect(screen.getByText("No composition assigned.")).toBeInTheDocument();
    expect(changes).toEqual([FIRST.ref, SECOND.ref, null]);
  });
});
