/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../test-support/cleanup";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/preact";
import { ComposerWorkspace } from "../composer-workspace";
import { ID_INSPECTOR_RAIL, ID_TREE_RAIL, MAX_RAIL_W, MIN_RAIL_W } from "../resizer-contract";

describe("ComposerWorkspace", () => {
  it("renders the toolbar, both resizer separators, and a canvas-only narrow note", () => {
    render(<ComposerWorkspace toolbar={<span>Toolbar</span>} />);
    expect(screen.getByText("Toolbar")).toBeInTheDocument();
    expect(screen.getAllByRole("separator")).toHaveLength(2);
    expect(screen.getByText("Canvas-only view")).toBeInTheDocument();
    expect(screen.getByText("Use a wider window to edit the tree and properties.")).toBeInTheDocument();
  });

  it("each resizer is a fully specified accessible separator", () => {
    render(<ComposerWorkspace toolbar={<span>Toolbar</span>} treeWidthPx={260} inspectorWidthPx={300} />);
    const [treeResizer, inspectorResizer] = screen.getAllByRole("separator");

    expect(treeResizer).toHaveAttribute("aria-orientation", "vertical");
    expect(treeResizer).toHaveAttribute("aria-controls", ID_TREE_RAIL);
    expect(treeResizer).toHaveAttribute("aria-valuemin", String(MIN_RAIL_W));
    expect(treeResizer).toHaveAttribute("aria-valuemax", String(MAX_RAIL_W));
    expect(treeResizer).toHaveAttribute("aria-valuenow", "260");
    expect(treeResizer).toHaveAttribute("tabindex", "0");
    expect(treeResizer).toHaveAttribute("data-sg-composer-tree-resizer");

    expect(inspectorResizer).toHaveAttribute("aria-controls", ID_INSPECTOR_RAIL);
    expect(inspectorResizer).toHaveAttribute("aria-valuenow", "300");
    expect(inspectorResizer).toHaveAttribute("data-sg-composer-inspector-resizer");
  });

  it("the tree/inspector/canvas rails carry their contract ids and default to labeled placeholders", () => {
    const { container } = render(<ComposerWorkspace toolbar={<span>Toolbar</span>} />);
    const treeRail = container.querySelector(`#${ID_TREE_RAIL}`);
    expect(treeRail).toHaveClass("sg-composer-tree-rail");
    expect(treeRail).not.toHaveClass("sg-composer-tree");
    expect(container.querySelector(`#${ID_INSPECTOR_RAIL}`)).not.toBeNull();
    expect(container.querySelector("[data-sg-composer-canvas]")).not.toBeNull();
    expect(screen.getByText("Structure")).toBeInTheDocument();
    expect(screen.getByText("Canvas")).toBeInTheDocument();
    expect(screen.getByText("Inspector")).toBeInTheDocument();
  });

  it("accepts typed slot overrides for tree/canvas/inspector without any other change", () => {
    render(
      <ComposerWorkspace
        toolbar={<span>Toolbar</span>}
        tree={<div>Real tree</div>}
        canvas={<div>Real canvas</div>}
        inspector={<div>Real inspector</div>}
      />,
    );
    expect(screen.getByText("Real tree")).toBeInTheDocument();
    expect(screen.getByText("Real canvas")).toBeInTheDocument();
    expect(screen.getByText("Real inspector")).toBeInTheDocument();
    expect(screen.queryByText("Structure")).not.toBeInTheDocument();
  });

  it("renders an optional banner between the toolbar and the grid", () => {
    render(<ComposerWorkspace toolbar={<span>Toolbar</span>} banner={<div>Recovered notice</div>} />);
    expect(screen.getByText("Recovered notice")).toBeInTheDocument();
  });
});
