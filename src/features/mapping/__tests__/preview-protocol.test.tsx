import { cleanup, render, waitFor } from "@testing-library/preact";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activeComponentProvider } from "../../composer/active-pack";
import { MappingPreviewHost } from "../preview-host";

describe("MappingPreviewHost", () => {
  afterEach(() => { cleanup(); document.documentElement.removeAttribute("data-theme"); });
  it("sends transient data in preview mode and exposes no Mapping chrome to the frame", () => {
    const renderSnapshot = vi.fn();
    const createBridge = vi.fn((options: Parameters<NonNullable<Parameters<typeof MappingPreviewHost>[0]["createBridge"]>>[0]) => { options.onReady?.(); return { render: renderSnapshot, updateSession: vi.fn(), restoreFocus: vi.fn(), dispose: vi.fn(), ready: true, terminal: false, revision: 0 }; });
    const component = activeComponentProvider.manifest.components[0]!;
    const document = { schemaVersion: 2 as const, id: "transient-preview", name: "Transient", root: [{ id: "node-1", componentId: component.id, componentVersion: component.schemaVersion, props: { ...component.defaults }, slots: Object.fromEntries(component.slots.map((slot) => [slot.id, []])) }] };
    const { container } = render(<MappingPreviewHost componentProvider={activeComponentProvider} document={document} createBridge={createBridge as never} location={{ src: "/composer/preview", targetOrigin: "https://example.test" }} hostWindow={{ addEventListener() {}, removeEventListener() {} }} />);
    expect(renderSnapshot).toHaveBeenCalledWith(expect.objectContaining({ document }), expect.objectContaining({ mode: "preview", selectedId: null }));
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe("/composer/preview"); expect(frame.getAttribute("sandbox")).toBe("allow-same-origin allow-scripts"); expect(frame.tabIndex).toBe(-1);
    expect(frame.contentDocument?.querySelector(".cms-mapping-root")).toBeNull();
  });

  it("keeps Mapping modules out of the direct preview route graph", () => {
    const root = process.cwd();
    for (const file of ["preview-entry.ts", "preview-app.ts", "renderer.ts", "client.ts"]) {
      const source = readFileSync(`${root}/src/features/composer/preview/${file}`, "utf8");
      expect(source).not.toMatch(/features\/mapping|\.\.\/\.\.\/mapping|cms-mapping/);
    }
  });

  it("resends the transient preview when the host theme changes", async () => {
    document.documentElement.dataset.theme = "light";
    const renderSnapshot = vi.fn();
    const createBridge = vi.fn(() => ({ render: renderSnapshot, updateSession: vi.fn(), restoreFocus: vi.fn(), dispose: vi.fn(), ready: true, terminal: false, revision: 0 }));
    const component = activeComponentProvider.manifest.components[0]!;
    const documentRecord = { schemaVersion: 2 as const, id: "theme-preview", name: "Theme", root: [{ id: "node-1", componentId: component.id, componentVersion: component.schemaVersion, props: { ...component.defaults }, slots: Object.fromEntries(component.slots.map((slot) => [slot.id, []])) }] };
    render(<MappingPreviewHost componentProvider={activeComponentProvider} document={documentRecord} createBridge={createBridge as never} location={{ src: "/composer/preview", targetOrigin: "https://example.test" }} hostWindow={{ addEventListener() {}, removeEventListener() {} }} />);
    expect(renderSnapshot).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ theme: "light" }));
    document.documentElement.dataset.theme = "dark";
    await waitFor(() => expect(renderSnapshot).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ theme: "dark" })));
  });
});
