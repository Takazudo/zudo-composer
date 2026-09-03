/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { MappingAssignmentCatalog } from "../../../../../sitemapper/routes";
import { MappingField } from "../mapping-field";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };
});
afterEach(cleanup);

const stamp = "2026-08-29T00:00:00.000Z";
const mappingMetadata = { name: "Article Mapping", model: "Articles", kind: "collection" as const, entryCount: 2, slugFields: [{ id: "slug", label: "URL slug" }, { id: "alternate-slug", label: "Alternate slug" }], titleFields: [{ id: "slug", label: "URL slug" }, { id: "title", label: "Title" }] };

function catalog(): MappingAssignmentCatalog {
  const record = { id: "articles", createdAt: stamp, updatedAt: stamp, document: { schemaVersion: 1 as const, id: "articles", name: "Article Mapping", contentModel: { providerId: "content", recordId: "articles" }, composition: { providerId: "indexeddb" as const, recordId: "article" }, bindings: [] } };
  const model = { id: "articles", createdAt: stamp, updatedAt: stamp, document: { schemaVersion: 1 as const, id: "articles", name: "Articles", kind: "collection" as const, fields: [{ id: "slug", key: "slug", label: "URL slug", required: true, kind: "slug" as const }, { id: "title", key: "title", label: "Title", required: false, kind: "text" as const }] } };
  return { list: vi.fn(async () => ({ entries: [{ ref: { providerId: "mapping", recordId: "articles" }, providerLabel: "Browser", summary: { id: "articles", name: "Article Mapping", createdAt: stamp, updatedAt: stamp, bindingCount: 0 } }], failures: [] })), routes: { list: vi.fn(), resolveMapping: vi.fn(async () => ({ status: "resolved" as const, record })), resolveDefinitionReadiness: vi.fn(async () => ({ status: "ready" as const })), resolveContentSnapshot: vi.fn(async () => ({ status: "resolved" as const, model, snapshot: { model, count: 2, diagnostics: [], entries: [{ schemaVersion: 1 as const, id: "one", modelId: "articles", createdAt: stamp, updatedAt: stamp, values: { slug: "one" } }, { schemaVersion: 1 as const, id: "two", modelId: "articles", createdAt: stamp, updatedAt: stamp, values: { slug: "two" } }] } })) } };
}

describe("MappingField", () => {
  it("names the mapping, its slug field and its route count, and humanises Ready", async () => {
    const sourceCatalog = catalog();
    render(<MappingField value={{ kind: "mapping", ref: { providerId: "mapping", recordId: "articles" }, route: { kind: "entry-field", fieldId: "slug" } }} routeInfo={{ status: "ready", derivedRouteCount: 2, samplePath: "/articles/one", diagnostics: [], mapping: mappingMetadata }} catalog={sourceCatalog} onChange={() => {}} />);
    expect(await screen.findByText("Article Mapping")).toBeInTheDocument();
    expect(screen.getByText("slug field: URL slug · 2 routes")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(sourceCatalog.routes.resolveMapping).not.toHaveBeenCalled();
  });

  it("authors an explicit Entry title field and preserves it when the slug field changes", async () => {
    const onChange = vi.fn();
    const value = { kind: "mapping" as const, ref: { providerId: "mapping", recordId: "articles" }, route: { kind: "entry-field" as const, fieldId: "slug", titleFieldId: "title" } };
    render(<MappingField value={value} routeInfo={{ status: "ready", derivedRouteCount: 2, diagnostics: [], mapping: mappingMetadata }} catalog={catalog()} onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Slug field" }), { target: { value: "alternate-slug" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ route: { kind: "entry-field", fieldId: "alternate-slug", titleFieldId: "title" } }));
    fireEvent.change(screen.getByRole("combobox", { name: "Entry title field" }), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ route: { kind: "entry-field", fieldId: "slug" } }));
  });

  it.each([
    { code: "route-collision" as const, message: "Route /articles/one collides with page \"static\"." },
    { code: "unsupported-external-base" as const, message: "HTTP(S) Mapping route bases are unsupported." },
  ])("uses canonical $code diagnostics so blocked routes cannot appear Ready", async ({ code, message }) => {
    const diagnostic = { code, nodeId: "articles", path: "/articles/one", message };
    render(<MappingField value={{ kind: "mapping", ref: { providerId: "mapping", recordId: "articles" }, route: { kind: "entry-field", fieldId: "slug" } }} routeInfo={{ status: "blocked", derivedRouteCount: 2, samplePath: "/articles/one", diagnostics: [diagnostic], mapping: mappingMetadata }} catalog={catalog()} onChange={() => {}} />);
    expect(await screen.findByText("Article Mapping")).toBeInTheDocument();
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();
  });

  it("keeps a broken reference visible and changeable", async () => {
    const sourceCatalog = catalog();
    const diagnostic = { code: "mapping-not-found" as const, nodeId: "articles", message: "The assigned Mapping was not found." };
    render(<MappingField value={{ kind: "mapping", ref: { providerId: "mapping", recordId: "gone" }, route: { kind: "single" } }} routeInfo={{ status: "blocked", derivedRouteCount: 0, diagnostics: [diagnostic] }} catalog={sourceCatalog} onChange={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("assigned Mapping was not found");
    fireEvent.click(screen.getByRole("button", { name: "Change…" }));
    expect(await screen.findByRole("dialog", { name: "Choose a Content Mapping" })).toBeInTheDocument();
    expect(sourceCatalog.routes.resolveMapping).not.toHaveBeenCalled();
  });

  it("keeps thrown Content provider failures visible", async () => {
    const sourceCatalog = catalog();
    const diagnostic = { code: "content-provider-failure" as const, nodeId: "articles", message: "Content provider offline" };
    render(<MappingField value={{ kind: "mapping", ref: { providerId: "mapping", recordId: "articles" }, route: { kind: "single" } }} routeInfo={{ status: "blocked", derivedRouteCount: 0, diagnostics: [diagnostic] }} catalog={sourceCatalog} onChange={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Content provider offline");
    expect(sourceCatalog.routes.resolveContentSnapshot).not.toHaveBeenCalled();
  });

  it("says why an assignment was abandoned instead of closing the dialog on nothing", async () => {
    const sourceCatalog = catalog();
    vi.mocked(sourceCatalog.routes.resolveMapping).mockResolvedValue({ status: "not-found" });
    render(<MappingField catalog={sourceCatalog} onChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Choose mapping…" }));
    const dialog = await screen.findByRole("dialog", { name: "Choose a Content Mapping" });
    fireEvent.click(await within(dialog).findByRole("button", { name: /Assign Article Mapping/ }));

    expect(await screen.findByText("That Mapping no longer exists, so nothing was assigned."))
      .toBeInTheDocument();
  });

  it("refuses a collection with no slug field rather than persisting a placeholder route", async () => {
    const sourceCatalog = catalog();
    const onChange = vi.fn();
    vi.mocked(sourceCatalog.routes.resolveContentSnapshot).mockImplementation(async () => {
      const resolved = await catalog().routes.resolveContentSnapshot({} as never);
      if (resolved.status !== "resolved") throw new Error("fixture");
      return {
        ...resolved,
        model: {
          ...resolved.model,
          document: { ...resolved.model.document, fields: resolved.model.document.fields.filter((field) => field.kind !== "slug") },
        },
      };
    });
    render(<MappingField catalog={sourceCatalog} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Choose mapping…" }));
    const dialog = await screen.findByRole("dialog", { name: "Choose a Content Mapping" });
    fireEvent.click(await within(dialog).findByRole("button", { name: /Assign Article Mapping/ }));

    expect(await screen.findByText("“Articles” has no slug field, so it derives no routes.")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("loads one injected catalog in the labelled assignment dialog", async () => {
    const sourceCatalog = catalog();
    render(<MappingField catalog={sourceCatalog} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose mapping…" }));
    expect(await screen.findByRole("dialog", { name: "Choose a Content Mapping" })).toBeInTheDocument();
    await waitFor(() => expect(sourceCatalog.list).toHaveBeenCalledTimes(1));
  });
});
