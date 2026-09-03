import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as overlay from "../index";

describe("overlay module", () => {
  it("carries its own presentation, so importing the module is enough to adopt it", () => {
    const index = readFileSync(resolve("src/components/overlay/index.ts"), "utf8");
    expect(index).toContain('import "./overlay.css";');
  });

  it("stays independent of the core control library, which lands separately", () => {
    for (const file of ["index.ts", "menu.tsx", "dialog.tsx", "confirm-dialog.tsx", "portal.tsx", "use-menu.ts"]) {
      const source = readFileSync(resolve("src/components/overlay", file), "utf8");
      expect(source).not.toMatch(/components\/ui|\.\.\/ui/);
    }
  });

  it("styles itself from tokens rather than colour literals", () => {
    const declarations = readFileSync(resolve("src/components/overlay/overlay.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(declarations).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|\bcolor\(/i);
  });

  it("exports the menu and dialog surface the routes build on", () => {
    expect(Object.keys(overlay).sort()).toEqual([
      "ConfirmDialog",
      "Dialog",
      "MENU_GAP",
      "MENU_MIN_HEIGHT",
      "MENU_VIEWPORT_MARGIN",
      "Menu",
      "MenuCheckboxItem",
      "MenuItem",
      "MenuRadioItem",
      "MenuSection",
      "MenuSeparator",
      "OverlayPortal",
      "computeMenuPosition",
      "useMenu",
    ]);
  });
});
