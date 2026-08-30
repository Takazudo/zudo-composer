// Plain `.ts` on purpose (no JSX, no @testing-library) — this file doubles as
// the proof that the icon module is importable without JSX tooling, which is
// the composer preview bundle's hard constraint (see the module header of
// `src/features/composer/preview/preview-app.ts`).

import { describe, expect, it } from "vitest";
import { h, render } from "preact";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as Icons from "../index";
import type { IconComponent, IconProps } from "../index";

// Keep this derived from the module namespace so adding a new named icon cannot
// silently skip the shared shell/paint/accessibility assertions below. Type
// exports do not exist at runtime, leaving only the actual component exports.
const ALL_ICONS = Object.fromEntries(
  Object.entries(Icons).filter(([, value]) => typeof value === "function"),
) as Record<string, IconComponent>;

function renderIcon(Icon: IconComponent, props: IconProps = {}): HTMLElement {
  const container = document.createElement("div");
  render(h(Icon, props), container);
  return container;
}

describe("icons module", () => {
  it("owns the exact local app-chrome icon spacing ladder", () => {
    const css = readFileSync(resolve("src/styles/app-tokens.css"), "utf8");
    expect(css).toMatch(/--spacing-icon-xs:\s*0\.75rem;/);
    expect(css).toMatch(/--spacing-icon-sm:\s*1rem;/);
    expect(css).toMatch(/--spacing-icon-md:\s*1\.25rem;/);
    expect(css).toMatch(/--spacing-icon-lg:\s*1\.5rem;/);
  });

  for (const [name, Icon] of Object.entries(ALL_ICONS)) {
    describe(name, () => {
      it("renders an <svg> with aria-hidden=\"true\"", () => {
        const container = renderIcon(Icon);
        const svg = container.querySelector("svg");
        expect(svg).not.toBeNull();
        expect(svg!.getAttribute("aria-hidden")).toBe("true");
        expect(svg!.getAttribute("aria-label")).toBeNull();
        expect(svg!.querySelector("[aria-label], [aria-labelledby], title")).toBeNull();
      });

      it("uses the 16 viewBox and currentColor only (no hardcoded colors)", () => {
        const container = renderIcon(Icon);
        const svg = container.querySelector("svg")!;
        expect(svg.getAttribute("viewBox")).toBe("0 0 16 16");
        const paints = [svg.getAttribute("fill"), svg.getAttribute("stroke")].filter(
          (paint): paint is string => paint !== null,
        );
        expect(paints.some((paint) => paint === "currentColor")).toBe(true);
        expect(paints.every((paint) => paint === "currentColor" || paint === "none")).toBe(true);
        expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(container.innerHTML).not.toMatch(/(?:fill|stroke)=["'](?!currentColor|none)[^"']+/);
      });
    });
  }

  it("default render wraps the svg in a span carrying the md size utilities", () => {
    const container = renderIcon(Icons.PlusIcon);
    const span = container.querySelector("span");
    expect(span).not.toBeNull();
    expect(span!.className).toContain("w-icon-md");
    expect(span!.className).toContain("h-icon-md");
    expect(span!.querySelector("svg")).not.toBeNull();
  });

  for (const size of ["xs", "sm", "md", "lg"] as const) {
    it(`size="${size}" maps to the w-icon-${size}/h-icon-${size} utilities`, () => {
      const container = renderIcon(Icons.ChevronRightIcon, { size });
      const span = container.querySelector("span")!;
      expect(span.className).toContain(`w-icon-${size}`);
      expect(span.className).toContain(`h-icon-${size}`);
    });
  }

  it("explicit width renders the bare svg with defaultSize filling height", () => {
    const container = renderIcon(Icons.XMarkIcon, { width: 12 });
    const svg = container.querySelector("svg")!;
    expect(container.querySelector("span")).toBeNull();
    expect(svg.getAttribute("width")).toBe("12");
    expect(svg.getAttribute("height")).toBe("16");
  });

  it("explicit height renders the bare svg with defaultSize filling width", () => {
    const container = renderIcon(Icons.XMarkIcon, { height: 12 });
    const svg = container.querySelector("svg")!;
    expect(container.querySelector("span")).toBeNull();
    expect(svg.getAttribute("width")).toBe("16");
    expect(svg.getAttribute("height")).toBe("12");
  });

  it("explicit width and height bypass the wrapper and preserve both dimensions", () => {
    const container = renderIcon(Icons.PreviewIcon, { width: 20, height: 10, class: "icon" });
    const svg = container.querySelector("svg")!;
    expect(container.querySelector("span")).toBeNull();
    expect(svg.getAttribute("width")).toBe("20");
    expect(svg.getAttribute("height")).toBe("10");
    expect(svg.getAttribute("class")).toBe("icon");
  });

  it("forwards class onto the wrapper span", () => {
    const container = renderIcon(Icons.TrashIcon, { class: "text-muted" });
    const span = container.querySelector("span")!;
    expect(span.className).toContain("text-muted");
  });

  it("keeps the preview import boundary plain TypeScript and JSX-free", () => {
    const source = readFileSync(resolve("src/components/icons/index.ts"), "utf8");
    expect(source).toMatch(/import \{ h \} from ["']preact["']/);
    expect(source).not.toMatch(/from ["'][^"']+\.tsx["']/);
    expect(source).not.toMatch(/^\s*<[A-Za-z][^>]*>/m);
  });
});
