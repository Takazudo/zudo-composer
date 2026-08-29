import { describe, expect, it } from "vitest";
import {
  ATTR_INSPECTOR_RESIZER,
  ATTR_TREE_RESIZER,
  CSS_VAR_INSPECTOR_W,
  CSS_VAR_TREE_W,
  LS_INSPECTOR_WIDTH,
  LS_TREE_WIDTH,
  MIN_CANVAS_W,
  MIN_RAIL_W,
  MAX_RAIL_W,
  RESIZER_TRACK_W,
  WIDTH_CHANGE_EVENT,
} from "../resizer-contract";
import { RESIZER_SCRIPT, RESTORE_SCRIPT } from "../resizer-scripts-source";

describe("Sitemapper RESTORE_SCRIPT", () => {
  it("embeds both namespaced storage keys and CSS variables", () => {
    expect(RESTORE_SCRIPT).toContain(`'${LS_TREE_WIDTH}'`);
    expect(RESTORE_SCRIPT).toContain(`'${LS_INSPECTOR_WIDTH}'`);
    expect(RESTORE_SCRIPT).toContain(`'${CSS_VAR_TREE_W}'`);
    expect(RESTORE_SCRIPT).toContain(`'${CSS_VAR_INSPECTOR_W}'`);
  });

  it("embeds the joint-clamp constants and protects first paint", () => {
    expect(RESTORE_SCRIPT).toContain(`MIN=${MIN_RAIL_W}`);
    expect(RESTORE_SCRIPT).toContain(`MAX=${MAX_RAIL_W}`);
    expect(RESTORE_SCRIPT).toContain(`MIN_CANVAS=${MIN_CANVAS_W}`);
    expect(RESTORE_SCRIPT).toContain(`TRACK=${RESIZER_TRACK_W}`);
    expect(RESTORE_SCRIPT).toContain("try {");
    expect(RESTORE_SCRIPT).toContain("catch(e) {}");
  });
});

describe("Sitemapper RESIZER_SCRIPT", () => {
  it("embeds both namespaced attributes, vars, keys, and event", () => {
    expect(RESIZER_SCRIPT).toContain(`[${ATTR_TREE_RESIZER}]`);
    expect(RESIZER_SCRIPT).toContain(`[${ATTR_INSPECTOR_RESIZER}]`);
    expect(RESIZER_SCRIPT).toContain(`'${CSS_VAR_TREE_W}'`);
    expect(RESIZER_SCRIPT).toContain(`'${CSS_VAR_INSPECTOR_W}'`);
    expect(RESIZER_SCRIPT).toContain(`'${LS_TREE_WIDTH}'`);
    expect(RESIZER_SCRIPT).toContain(`'${LS_INSPECTOR_WIDTH}'`);
    expect(RESIZER_SCRIPT).toContain(`'${WIDTH_CHANGE_EVENT}'`);
    expect(RESIZER_SCRIPT).toContain("__sgSitemapperResizerObserver");
  });

  it("wires pointer capture and keyboard resize controls", () => {
    expect(RESIZER_SCRIPT).toContain("setPointerCapture");
    expect(RESIZER_SCRIPT).toContain("ArrowLeft");
    expect(RESIZER_SCRIPT).toContain("ArrowRight");
    expect(RESIZER_SCRIPT).toContain("'Home'");
    expect(RESIZER_SCRIPT).toContain("'End'");
  });

  it("uses per-element idempotency and retries late island hydration", () => {
    expect(RESIZER_SCRIPT).toContain("__sgWired");
    expect(RESIZER_SCRIPT).toContain("MutationObserver");
    expect(RESIZER_SCRIPT).not.toContain("__sgSitemapperResizersInstalled");
    expect(RESIZER_SCRIPT).not.toContain("__sgComposer");
  });

  it("dispatches only at the commit point, not from apply", () => {
    const applyBody = RESIZER_SCRIPT.slice(
      RESIZER_SCRIPT.indexOf("function apply(px)"),
      RESIZER_SCRIPT.indexOf("function commit()"),
    );
    expect(applyBody).not.toContain("dispatchChange(");
    const commitBody = RESIZER_SCRIPT.slice(
      RESIZER_SCRIPT.indexOf("function commit()"),
      RESIZER_SCRIPT.indexOf("handle.setAttribute('aria-valuemin'"),
    );
    expect(commitBody).toContain("dispatchChange(options.rail, cached)");
    expect(RESIZER_SCRIPT.match(/commit\(\);/g) ?? []).toHaveLength(2);
  });
});
