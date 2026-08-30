import { render, screen, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import { defineComponentPack } from "@zudo-composer/component-contract";
import { CompositionCanvas } from "../renderer";
import { fixtureComponentProvider, createFixtureSampleDocument } from "../../test-support/fixture-pack";
import { createComposerComponentProvider } from "../../component-provider";
import { ComposerCanvasHost } from "../../app/composer-canvas-host";
import { createComposerPreviewBridge } from "../bridge";
import type { JsonObject } from "../../../../composer/browser";

describe("CompositionCanvas provider view", () => {
  it("passes structured field records to Hero unchanged rather than rendering them as VNodes", () => {
    const actions: JsonObject[] = [
      { label: "Read docs", href: "/docs", variant: "secondary" },
      { label: "Get started", href: "/start" },
    ];
    const received: unknown[] = [];
    const Hero = (_props: { actions: readonly JsonObject[] }) => null;
    const provider = createComposerComponentProvider(defineComponentPack({
      packId: "@test/hero-actions",
      packVersion: "1.0.0",
      components: [{
        id: "ui.hero",
        schemaVersion: 1,
        title: "Hero",
        category: "Content",
        description: "Structured action renderer fixture.",
        source: { module: "@test/hero-actions", exportKind: "named", exportName: "Hero" },
        defaults: { actions: [{ label: "Default", href: "/" }] },
        fields: [{
          prop: "actions",
          label: "Actions",
          schema: {
            type: "array",
            items: {
              schema: {
                type: "object",
                fields: [
                  { key: "label", label: "Label", required: true, schema: { type: "string" }, editor: { kind: "text" } },
                  { key: "href", label: "URL", required: true, schema: { type: "string" }, editor: { kind: "text" } },
                  { key: "variant", label: "Variant", schema: { type: "string", enum: ["primary", "secondary"] }, editor: { kind: "select" } },
                ],
              },
              editor: { kind: "group" },
            },
          },
          editor: { kind: "list" },
        }],
        slots: [],
        component: Hero,
        adapters: { render: (props: Partial<{ actions: readonly JsonObject[] }>) => { received.push(props.actions); return null; } },
      }],
    }));
    const document = createFixtureSampleDocument();
    document.root = [{
      id: "hero",
      componentId: "ui.hero",
      componentVersion: 1,
      props: { actions },
      slots: {},
    }];

    render(<CompositionCanvas document={document} localRecordId={document.id} provider={provider} session={{ mode: "preview", theme: "light", selectedId: null }} onSelect={vi.fn()} onRequestAdd={vi.fn()} onRequestNodeMenu={vi.fn()} onRequestInsertMenu={vi.fn()} />);

    expect(received).toEqual([actions]);
    expect(received[0]).toBe(actions);
    expect(Array.isArray(received[0])).toBe(true);
  });

  it("renders both named Split slots from the injected provider", () => {
    const document = createFixtureSampleDocument();
    document.root = [{
      id: "split", componentId: "fixture.split", componentVersion: 1, props: {},
      slots: {
        left: [{ id: "left", componentId: "fixture.text", componentVersion: 1, props: { children: "Left content" }, slots: {} }],
        right: [{ id: "right", componentId: "fixture.button", componentVersion: 1, props: { children: "Right action" }, slots: {} }],
      },
    }];
    const { container } = render(<CompositionCanvas document={document} localRecordId={document.id} provider={fixtureComponentProvider} session={{ mode: "preview", theme: "light", selectedId: null }} onSelect={vi.fn()} onRequestAdd={vi.fn()} onRequestNodeMenu={vi.fn()} onRequestInsertMenu={vi.fn()} />);
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
    const document = createFixtureSampleDocument();
    const common = {
      document,
      session: { mode: "edit", theme: "light", selectedId: null } as const,
      viewport: "fluid" as const,
      onSelect: vi.fn(), onRequestAdd: vi.fn(), onRequestNodeMenu: vi.fn(),
      onRequestInsertMenu: vi.fn(), onCommitInlineEdit: vi.fn(), onDropNode: vi.fn(),
      createBridge,
      location: { src: "/composer/preview", targetOrigin: "https://composer.test" },
    };
    const first = render(<ComposerCanvasHost {...common} componentProvider={fixtureComponentProvider} />);
    await waitFor(() => expect(captured).toHaveLength(1));
    first.unmount();
    render(<ComposerCanvasHost {...common} componentProvider={alternate} />);
    await waitFor(() => expect(captured).toHaveLength(2));
    expect(captured).toEqual([
      { packId: fixtureComponentProvider.manifest.packId, packVersion: fixtureComponentProvider.manifest.packVersion },
      { packId: alternate.manifest.packId, packVersion: alternate.manifest.packVersion },
    ]);
  });
});
