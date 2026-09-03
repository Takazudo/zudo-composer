import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as ui from "../index";

const indexSource = readFileSync(resolve("src/components/ui/index.ts"), "utf8");

describe("ui module contract", () => {
  it("carries its own stylesheet, so a route importing the library gets the CSS", () => {
    expect(indexSource).toContain('import "./ui.css";');
  });

  it("keeps the controls out of the global stylesheet", () => {
    // Only tokens belong to the app sheets; the controls travel with their module.
    expect(readFileSync(resolve("src/style.css"), "utf8")).not.toContain("components/ui");
    expect(readFileSync(resolve("src/base.css"), "utf8")).not.toContain("components/ui");
  });

  it("exports every control the chrome is built from", () => {
    expect(Object.keys(ui).sort()).toEqual(
      [
        "Banner",
        "Button",
        "Checkbox",
        "Chip",
        "CountBadge",
        "DataTable",
        "EmptyState",
        "Field",
        "FieldContext",
        "Input",
        "Kbd",
        "Pane",
        "PaneBody",
        "PaneHeader",
        "PaneSection",
        "PaneTabs",
        "SegmentedControl",
        "Select",
        "StatusChip",
        "Switch",
        "Textarea",
        "cx",
        "nextRovingIndex",
        "useFieldControl",
      ].sort(),
    );
  });
});
