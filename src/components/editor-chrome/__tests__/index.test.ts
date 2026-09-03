import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as editorChrome from "../index";

const indexSource = readFileSync(resolve("src/components/editor-chrome/index.ts"), "utf8");

describe("editor-chrome module contract", () => {
  it("carries its own stylesheet, so a route importing the chrome gets the CSS", () => {
    expect(indexSource).toContain('import "./editor-chrome.css";');
  });

  it("keeps the chrome out of the global stylesheets", () => {
    expect(readFileSync(resolve("src/style.css"), "utf8")).not.toContain("components/editor-chrome");
    expect(readFileSync(resolve("src/base.css"), "utf8")).not.toContain("components/editor-chrome");
  });

  it("exports the chrome, its body, and the rail geometry the two share", () => {
    expect(Object.keys(editorChrome).sort()).toEqual(
      [
        "CSS_VAR_INSP_W",
        "CSS_VAR_NAV_W",
        "DEFAULT_INSP_W",
        "DEFAULT_NAV_W",
        "EDITOR_PANES",
        "EditorBody",
        "EditorChrome",
        "EditorChromeContext",
        "EditorRailsContext",
        "MAX_RAIL_W",
        "MIN_MAIN_W",
        "MIN_RAIL_W",
        "RAIL_STEP_W",
        "RESIZER_TRACK_W",
        "RailCollapseButton",
        "RecordTitle",
        "WIDTH_CHANGE_EVENT",
        "clampRailWidth",
        "cssVarForRail",
        "getPersistedWidth",
        "installRailResizer",
        "maxRailWidth",
        "railStorageKey",
        "readEditorWidths",
        "setPersistedWidth",
        "useBeforeUnloadGuard",
        "useEditorChrome",
        "useEditorRails",
      ].sort(),
    );
  });

  it("styles every class it renders with the cms- prefix the chrome agreed on", () => {
    const sheet = readFileSync(resolve("src/components/editor-chrome/editor-chrome.css"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const classes = new Set(sheet.match(/\.[a-z][a-z0-9_-]*/g) ?? []);
    // `nav-collapsed` / `insp-collapsed` are the epic's fixed state names; they
    // are only ever compounded onto `.cms-editor__body`, never used alone.
    const unprefixed = [...classes].filter((name) => !name.startsWith(".cms-")).sort();
    expect(unprefixed).toEqual([".insp-collapsed", ".nav-collapsed"]);
  });
});
