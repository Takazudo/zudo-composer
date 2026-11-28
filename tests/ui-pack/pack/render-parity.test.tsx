/**
 * The Composer preview renderer remounts a node on every prop change, so a
 * pack component only ever renders its first frame from plain-value props.
 * That frame must be the same markup under `renderToString` (static delivery,
 * catalog SSR) and under a client mount (the preview iframe).
 */
import { h, type Child, type Component } from "@takazudo/zfb/zudo-react";
import { renderToString } from "@takazudo/zfb/zudo-react/server";
import { describe, expect, it, vi } from "vitest";
import {
  componentPackManifest,
  componentRuntimeRegistry,
} from "../../../packages/ui/src/composer-pack";
import { render } from "../../../src/test/render";

vi.mock("../../../packages/ui/src/content/prose-md/markdown-runtime", () => ({
  renderMarkdown: vi.fn(() => new Promise(() => {})),
}));

// A client mount keeps its region anchors as comments; the server string has none.
const REGION_ANCHOR = /<!--\/?zr:[^>]*-->/g;

function slotFill(id: string): Child {
  return h("span", { "data-slot-fill": id }, `slot ${id}`);
}

describe("@zudo-composer/ui first-frame parity", () => {
  it("covers the 12-component set", () => {
    expect(componentPackManifest.components).toHaveLength(12);
  });

  for (const manifest of componentPackManifest.components) {
    it(`${manifest.id} renders the same markup on the server and the client`, () => {
      const entry = componentRuntimeRegistry.components[manifest.id];
      expect(entry).toBeDefined();
      const props: Record<string, unknown> = { ...manifest.defaults };
      for (const slot of manifest.slots ?? []) props[slot.prop] = slotFill(slot.id);
      const node = h(entry!.component as Component<Record<string, unknown>>, props);

      const server = renderToString(node);
      const { container } = render(node);

      expect(container.innerHTML.replace(REGION_ANCHOR, "")).toBe(server);
      expect(server).not.toBe("");
    });
  }
});
