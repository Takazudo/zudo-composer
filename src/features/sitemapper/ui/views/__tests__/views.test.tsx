/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SitemapDocument } from "../../../../../sitemapper/model";
import { SITEMAP_SCHEMA_VERSION } from "../../../../../sitemapper/model";
import type { SitemapRouteExpansion } from "../../../../../sitemapper/routes";
import { NavigationPane } from "../navigation-pane";
import { RoutePreviewPane, routeIdentity } from "../route-preview-pane";

afterEach(cleanup);

const document: SitemapDocument = {
  schemaVersion: SITEMAP_SCHEMA_VERSION,
  id: "views",
  name: "Views",
  navigation: {
    primary: [{ id: "home-link", label: "Home", visible: true, destination: { kind: "route", nodeId: "home" } }],
    footer: [],
  },
  root: [{ id: "home", title: "Home", source: { kind: "unassigned" }, children: [] }],
};

const expansion: SitemapRouteExpansion = {
  routes: [{ pathname: "/", nodeId: "home", sourceKind: "unassigned", displayTitle: "Home", ancestors: [] }],
  derivedRouteCount: 1,
  samplePath: "/",
  diagnostics: [],
  nodes: new Map([[
    "home",
    { derivedRouteCount: 1, samplePath: "/", status: "ready", diagnostics: [] },
  ]]),
};

describe("Sitemapper unified views", () => {
  it("renders the real concrete route table and shares page selection", () => {
    const onSelect = vi.fn();
    render(<RoutePreviewPane document={document} authoredRoutes={new Map([["home", "/"]])} expansion={expansion} selectedId={null} onSelect={onSelect} />);
    expect(screen.getByText("Concrete path")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "/" }));
    expect(onSelect).toHaveBeenCalledWith("home");
  });

  it("commits navigation labels through the validated controller seam", () => {
    const onEdit = vi.fn();
    render(<NavigationPane document={document} expansion={expansion} selectedId={null} onSelect={vi.fn()} onEdit={onEdit} />);
    const label = screen.getByRole("textbox", { name: "primary menu label for home-link" });
    fireEvent.input(label, { target: { value: "Start" } });
    fireEvent.blur(label);
    expect(onEdit).toHaveBeenCalledWith("primary", {
      kind: "put",
      index: 0,
      item: expect.objectContaining({ id: "home-link", label: "Start" }),
    });
  });

  it("stages focused label edits with a flush callback instead of waiting for blur", () => {
    const onDraft = vi.fn();
    const onFlush = vi.fn();
    const onEdit = vi.fn();
    render(<NavigationPane document={document} expansion={expansion} selectedId={null} onSelect={vi.fn()} onEdit={onEdit} onDraft={onDraft} onFlush={onFlush} />);
    const label = screen.getByRole("textbox", { name: "primary menu label for home-link" });
    fireEvent.input(label, { target: { value: "Start" } });
    expect(onDraft).toHaveBeenCalledWith("primary", "home-link", { label: "Start" });
    expect(onEdit).not.toHaveBeenCalled();
    fireEvent.blur(label);
    expect(onFlush).toHaveBeenCalledOnce();
  });

  it("keeps provider-qualified route identity in concrete rows", () => {
    const first = { ...expansion.routes[0]!, selectedEntry: { providerId: "content-a", modelId: "model", recordId: "entry" }, entryId: "entry" };
    const second = { ...first, selectedEntry: { providerId: "content-b", modelId: "model", recordId: "entry" } };
    expect(routeIdentity(first)).not.toBe(routeIdentity(second));
  });

  it("keeps blocking diagnostics without routes visible and navigable", () => {
    const onSelect = vi.fn();
    const broken: SitemapRouteExpansion = {
      ...expansion,
      diagnostics: [{ code: "mapping-not-found", nodeId: "broken", message: "The assigned Mapping was not found." }],
    };
    render(<RoutePreviewPane document={document} authoredRoutes={new Map([["home", "/"]])} expansion={broken} selectedId={null} onSelect={onSelect} />);
    expect(screen.getByText("The assigned Mapping was not found.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Inspect node" }));
    expect(onSelect).toHaveBeenCalledWith("broken");
  });
});
