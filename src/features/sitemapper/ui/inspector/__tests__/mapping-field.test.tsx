/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MappingAssignmentCatalog } from "../../../../../sitemapper/routes";
import { MappingField } from "../mapping-field";

afterEach(cleanup);
const stamp = "2026-08-29T00:00:00.000Z";
const mappingMetadata = { name: "Article Mapping", model: "Articles", kind: "collection" as const, entryCount: 2, slugFields: [{ id: "slug", label: "URL slug" }] };
function catalog(): MappingAssignmentCatalog {
  const record = { id: "articles", createdAt: stamp, updatedAt: stamp, document: { schemaVersion: 1 as const, id: "articles", name: "Article Mapping", contentModel: { providerId: "content", recordId: "articles" }, composition: { providerId: "indexeddb" as const, recordId: "article" }, bindings: [] } };
  const model = { id: "articles", createdAt: stamp, updatedAt: stamp, document: { schemaVersion: 1 as const, id: "articles", name: "Articles", kind: "collection" as const, fields: [{ id: "slug", key: "slug", label: "URL slug", required: true, kind: "slug" as const }] } };
  return { list: vi.fn(async () => ({ entries: [{ ref: { providerId: "mapping", recordId: "articles" }, providerLabel: "Browser", summary: { id: "articles", name: "Article Mapping", createdAt: stamp, updatedAt: stamp, bindingCount: 0 } }], failures: [] })), routes: { list: vi.fn(), resolveMapping: vi.fn(async () => ({ status: "resolved" as const, record })), resolveDefinitionReadiness: vi.fn(async () => ({ status: "ready" as const })), resolveContentSnapshot: vi.fn(async () => ({ status: "resolved" as const, model, snapshot: { model, count: 2, diagnostics: [], entries: [{ schemaVersion: 1 as const, id: "one", modelId: "articles", createdAt: stamp, updatedAt: stamp, values: { slug: "one" } }, { schemaVersion: 1 as const, id: "two", modelId: "articles", createdAt: stamp, updatedAt: stamp, values: { slug: "two" } }] } })) } };
}

describe("MappingField", () => {
  it("shows Mapping/model readiness, route choice, Entry and derived counts, and sample", async () => {
    const sourceCatalog = catalog();
    render(<MappingField value={{ kind: "mapping", ref: { providerId: "mapping", recordId: "articles" }, route: { kind: "entry-field", fieldId: "slug" } }} routeInfo={{ status: "ready", derivedRouteCount: 2, samplePath: "/parent/articles/one", diagnostics: [], mapping: mappingMetadata }} catalog={sourceCatalog} onChange={() => {}} />);
    expect(await screen.findByText("Article Mapping")).toBeInTheDocument();
    expect(screen.getByText("Articles · collection")).toBeInTheDocument();
    expect(screen.getByText("/parent/articles/one")).toBeInTheDocument();
    expect(screen.getAllByText("2")).toHaveLength(2);
    expect(sourceCatalog.routes.resolveMapping).not.toHaveBeenCalled();
    expect(sourceCatalog.routes.resolveContentSnapshot).not.toHaveBeenCalled();
  });

  it.each([
    { code: "route-collision" as const, message: "Route /articles/one collides with page \"static\"." },
    { code: "unsupported-external-base" as const, message: "HTTP(S) Mapping route bases are unsupported." },
  ])("uses canonical $code diagnostics so blocked routes cannot appear Ready", async ({ code, message }) => {
    const diagnostic = { code, nodeId: "articles", path: "/articles/one", message };
    render(<MappingField value={{ kind: "mapping", ref: { providerId: "mapping", recordId: "articles" }, route: { kind: "entry-field", fieldId: "slug" } }} routeInfo={{ status: "blocked", derivedRouteCount: 2, samplePath: "/articles/one", diagnostics: [diagnostic], mapping: mappingMetadata }} catalog={catalog()} onChange={() => {}} />);
    expect(await screen.findByText("Article Mapping")).toBeInTheDocument();
    expect(screen.getByText("Needs repair")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();
  });

  it("keeps broken refs visible and clearable", async () => {
    const sourceCatalog = catalog(); const onChange = vi.fn();
    const diagnostic = { code: "mapping-not-found" as const, nodeId: "articles", message: "The assigned Mapping was not found." };
    render(<MappingField value={{ kind: "mapping", ref: { providerId: "mapping", recordId: "gone" }, route: { kind: "single" } }} routeInfo={{ status: "blocked", derivedRouteCount: 0, diagnostics: [diagnostic] }} catalog={sourceCatalog} onChange={onChange} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("assigned Mapping was not found");
    fireEvent.click(screen.getByRole("button", { name: "Clear Mapping" }));
    expect(onChange).toHaveBeenCalledWith({ kind: "unassigned" });
    expect(sourceCatalog.routes.resolveMapping).not.toHaveBeenCalled();
  });

  it("keeps thrown Content provider failures visible and clearable", async () => {
    const sourceCatalog = catalog();
    const diagnostic = { code: "content-provider-failure" as const, nodeId: "articles", message: "Content provider offline" };
    render(<MappingField value={{ kind: "mapping", ref: { providerId: "mapping", recordId: "articles" }, route: { kind: "single" } }} routeInfo={{ status: "blocked", derivedRouteCount: 0, diagnostics: [diagnostic] }} catalog={sourceCatalog} onChange={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Content provider offline");
    expect(sourceCatalog.routes.resolveContentSnapshot).not.toHaveBeenCalled();
  });

  it("loads one injected catalog in the labelled assignment dialog", async () => {
    const sourceCatalog = catalog(); render(<MappingField catalog={sourceCatalog} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose Content Mapping" }));
    expect(await screen.findByRole("dialog", { name: "Choose a Content Mapping" })).toHaveAttribute("aria-busy", "false");
    await waitFor(() => expect(sourceCatalog.list).toHaveBeenCalledTimes(1));
  });
});
