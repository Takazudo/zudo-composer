import { render, screen, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import { defineComponentPack } from "@zudo-composer/component-contract";
import { CompositionCanvas } from "../renderer";
import { activeComponentProvider, createActiveSampleDocument, createComposerComponentProvider } from "../../active-pack";
import { ComposerCanvasHost } from "../../app/composer-canvas-host";
import { createComposerPreviewBridge } from "../bridge";

describe("CompositionCanvas provider view", () => {
  it("renders both named Split slots from the injected provider", () => {
    const document = createActiveSampleDocument();
    document.root = [{
      id: "split", componentId: "fixture.split", componentVersion: 1, props: {},
      slots: {
        left: [{ id: "left", componentId: "fixture.text", componentVersion: 1, props: { children: "Left content" }, slots: {} }],
        right: [{ id: "right", componentId: "fixture.button", componentVersion: 1, props: { children: "Right action" }, slots: {} }],
      },
    }];
    const { container } = render(<CompositionCanvas document={document} localRecordId={document.id} provider={activeComponentProvider} session={{ mode: "preview", theme: "light", selectedId: null }} onSelect={vi.fn()} onRequestAdd={vi.fn()} onRequestNodeMenu={vi.fn()} onRequestInsertMenu={vi.fn()} />);
    expect(screen.getByText("Left content")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Right action" })).toBeInTheDocument();
    expect(container.querySelectorAll(".composer-fixture-split-column")).toHaveLength(2);
  });

  it("derives each host handshake from its injected validated provider", async () => {
    const alternate = createComposerComponentProvider(defineComponentPack({
      packId: "@test/alternate",
      packVersion: "2.0.0",
      components: [{
        id: "alternate.text",
        schemaVersion: 1,
        title: "Alternate",
        category: "Test",
        description: "Alternate test component.",
        source: { module: "@test/alternate", exportKind: "named", exportName: "Alternate" },
        defaults: {},
        fields: [],
        slots: [],
        component: () => null,
      }],
    }));
    const captured: Array<{ packId: string; packVersion: string }> = [];
    const createBridge: typeof createComposerPreviewBridge = (options) => {
      captured.push(options.pack);
      return {
        render: () => 0,
        updateSession: () => 0,
        restoreFocus: () => undefined,
        ready: false,
        terminal: false,
        revision: -1,
        dispose: () => undefined,
      };
    };
    const document = createActiveSampleDocument();
    const common = {
      document,
      session: { mode: "edit", theme: "light", selectedId: null } as const,
      viewport: "fluid" as const,
      onSelect: vi.fn(), onRequestAdd: vi.fn(), onRequestNodeMenu: vi.fn(),
      onRequestInsertMenu: vi.fn(), onCommitInlineEdit: vi.fn(), onDropNode: vi.fn(),
      createBridge,
      location: { src: "/composer/preview", targetOrigin: "https://composer.test" },
    };
    const first = render(<ComposerCanvasHost {...common} componentProvider={activeComponentProvider} />);
    await waitFor(() => expect(captured).toHaveLength(1));
    first.unmount();
    render(<ComposerCanvasHost {...common} componentProvider={alternate} />);
    await waitFor(() => expect(captured).toHaveLength(2));
    expect(captured).toEqual([
      { packId: activeComponentProvider.manifest.packId, packVersion: activeComponentProvider.manifest.packVersion },
      { packId: alternate.manifest.packId, packVersion: alternate.manifest.packVersion },
    ]);
  });
});
