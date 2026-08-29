import { render } from "@testing-library/preact";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { activeComponentProvider } from "../../composer/active-pack";
import { MappingPreviewHost } from "../preview-host";

describe("MappingPreviewHost", () => {
  it("sends transient data in preview mode and exposes no Mapping chrome to the frame", () => {
    const renderSnapshot = vi.fn();
    const createBridge = vi.fn((options: Parameters<NonNullable<Parameters<typeof MappingPreviewHost>[0]["createBridge"]>>[0]) => { options.onReady?.(); return { render: renderSnapshot, updateSession: vi.fn(), restoreFocus: vi.fn(), dispose: vi.fn(), ready: true, terminal: false, revision: 0 }; });
    const component = activeComponentProvider.manifest.components[0]!;
    const document = { schemaVersion: 2 as const, id: "transient-preview", name: "Transient", root: [{ id: "node-1", componentId: component.id, componentVersion: component.schemaVersion, props: { ...component.defaults }, slots: Object.fromEntries(component.slots.map((slot) => [slot.id, []])) }] };
    const { container } = render(<MappingPreviewHost componentProvider={activeComponentProvider} document={document} createBridge={createBridge as never} location={{ src: "/composer/preview", targetOrigin: "https://example.test" }} hostWindow={{ addEventListener() {}, removeEventListener() {} }} />);
    expect(renderSnapshot).toHaveBeenCalledWith(expect.objectContaining({ document }), expect.objectContaining({ mode: "preview", selectedId: null }));
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe("/composer/preview"); expect(frame.getAttribute("sandbox")).toBe("allow-same-origin allow-scripts"); expect(frame.tabIndex).toBe(-1);
    expect(frame.contentDocument?.querySelector(".sg-mapping-app")).toBeNull();
  });

  it("keeps Mapping modules out of the direct preview route graph", () => {
    const root = process.cwd();
    for (const file of ["preview-entry.ts", "preview-app.ts", "renderer.ts", "client.ts"]) {
      const source = readFileSync(`${root}/src/features/composer/preview/${file}`, "utf8");
      expect(source).not.toMatch(/features\/mapping|\.\.\/\.\.\/mapping|sg-mapping/);
    }
  });
});
