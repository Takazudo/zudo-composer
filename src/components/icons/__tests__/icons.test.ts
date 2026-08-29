// Plain `.ts` on purpose (no JSX, no @testing-library) — this file doubles as
// the proof that the icon module is importable without JSX tooling, which is
// the composer preview bundle's hard constraint (see the module header of
// `src/features/composer/preview/preview-app.ts`).

import { describe, expect, it } from "vitest";
import { h, render } from "preact";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ContainerIcon,
  CopyIcon,
  CutIcon,
  DragGripIcon,
  DuplicateIcon,
  EllipsisIcon,
  ExpandIcon,
  LeafIcon,
  PageIcon,
  PlusIcon,
  SlotIcon,
  TrashIcon,
  XMarkIcon,
  type IconComponent,
  type IconProps,
} from "../index";

const ALL_ICONS: Record<string, IconComponent> = {
  ChevronRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  PlusIcon,
  XMarkIcon,
  EllipsisIcon,
  CopyIcon,
  CutIcon,
  DuplicateIcon,
  DragGripIcon,
  TrashIcon,
  ExpandIcon,
  PageIcon,
  SlotIcon,
  ContainerIcon,
  LeafIcon,
};

function renderIcon(Icon: IconComponent, props: IconProps = {}): HTMLElement {
  const container = document.createElement("div");
  render(h(Icon, props), container);
  return container;
}

describe("icons module", () => {
  for (const [name, Icon] of Object.entries(ALL_ICONS)) {
    describe(name, () => {
      it("renders an <svg> with aria-hidden=\"true\"", () => {
        const container = renderIcon(Icon);
        const svg = container.querySelector("svg");
        expect(svg).not.toBeNull();
        expect(svg!.getAttribute("aria-hidden")).toBe("true");
      });

      it("uses the 16 viewBox and currentColor only (no hardcoded hex)", () => {
        const container = renderIcon(Icon);
        const svg = container.querySelector("svg")!;
        expect(svg.getAttribute("viewBox")).toBe("0 0 16 16");
        expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      });
    });
  }

  it("default render wraps the svg in a span carrying the md size utilities", () => {
    const container = renderIcon(PlusIcon);
    const span = container.querySelector("span");
    expect(span).not.toBeNull();
    expect(span!.className).toContain("w-icon-md");
    expect(span!.className).toContain("h-icon-md");
    expect(span!.querySelector("svg")).not.toBeNull();
  });

  for (const size of ["xs", "sm", "md", "lg"] as const) {
    it(`size="${size}" maps to the w-icon-${size}/h-icon-${size} utilities`, () => {
      const container = renderIcon(ChevronRightIcon, { size });
      const span = container.querySelector("span")!;
      expect(span.className).toContain(`w-icon-${size}`);
      expect(span.className).toContain(`h-icon-${size}`);
    });
  }

  it("explicit width renders the bare svg with defaultSize filling height", () => {
    const container = renderIcon(XMarkIcon, { width: 12 });
    const svg = container.querySelector("svg")!;
    expect(container.querySelector("span")).toBeNull();
    expect(svg.getAttribute("width")).toBe("12");
    expect(svg.getAttribute("height")).toBe("16");
  });

  it("forwards class onto the wrapper span", () => {
    const container = renderIcon(TrashIcon, { class: "text-muted" });
    const span = container.querySelector("span")!;
    expect(span.className).toContain("text-muted");
  });
});
