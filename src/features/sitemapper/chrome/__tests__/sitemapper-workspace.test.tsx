/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/preact";
import {
  SitemapperWorkspace,
} from "../sitemapper-workspace";

afterEach(cleanup);
import {
  ATTR_INSPECTOR_RESIZER,
  ATTR_TREE_RESIZER,
  DEFAULT_INSPECTOR_W,
  DEFAULT_TREE_W,
  ID_INSPECTOR_RAIL,
  ID_TREE_RAIL,
  MAX_RAIL_W,
  MIN_RAIL_W,
} from "../resizer-contract";

describe("SitemapperWorkspace", () => {
  it("renders the toolbar, two separators, and the narrow canvas note", () => {
    render(<SitemapperWorkspace toolbar={<span>Toolbar</span>} />);
    expect(screen.getByText("Toolbar")).toBeInTheDocument();
    expect(screen.getAllByRole("separator")).toHaveLength(2);
    expect(screen.getByText("Canvas-only view")).toBeInTheDocument();
  });

  it("keeps all rails and resizers in the DOM and specifies accessible defaults", () => {
    const { container } = render(<SitemapperWorkspace />);
    expect(container.querySelector(`#${ID_TREE_RAIL}`)).toBeInTheDocument();
    expect(container.querySelector(`#${ID_INSPECTOR_RAIL}`)).toBeInTheDocument();
    expect(container.querySelector(`[${ATTR_TREE_RESIZER}]`)).toBeInTheDocument();
    expect(container.querySelector(`[${ATTR_INSPECTOR_RESIZER}]`)).toBeInTheDocument();

    const [treeResizer, inspectorResizer] = screen.getAllByRole("separator");
    expect(treeResizer).toHaveAttribute("aria-orientation", "vertical");
    expect(treeResizer).toHaveAttribute("aria-controls", ID_TREE_RAIL);
    expect(treeResizer).toHaveAttribute("aria-valuemin", String(MIN_RAIL_W));
    expect(treeResizer).toHaveAttribute("aria-valuemax", String(MAX_RAIL_W));
    expect(treeResizer).toHaveAttribute("aria-valuenow", String(DEFAULT_TREE_W));
    expect(treeResizer).toHaveAttribute("tabindex", "0");
    expect(inspectorResizer).toHaveAttribute("aria-controls", ID_INSPECTOR_RAIL);
    expect(inspectorResizer).toHaveAttribute("aria-valuenow", String(DEFAULT_INSPECTOR_W));
  });

  it("falls back to a labeled pane for every visual surface", () => {
    render(<SitemapperWorkspace />);
    for (const label of ["Toolbar", "Banner", "Tree", "Canvas", "Inspector"]) {
      expect(screen.getByText(label, { exact: true })).toBeInTheDocument();
    }
  });

  it("accepts typed slot overrides without changing the shell", () => {
    render(
      <SitemapperWorkspace
        toolbar={<span>Real toolbar</span>}
        banner={<div>Recovered notice</div>}
        tree={<div>Real outline</div>}
        canvas={<div>Real canvas</div>}
        inspector={<div>Real inspector</div>}
        treeWidthPx={260}
        inspectorWidthPx={300}
      />,
    );
    expect(screen.getByText("Real toolbar")).toBeInTheDocument();
    expect(screen.getByText("Recovered notice")).toBeInTheDocument();
    expect(screen.getByText("Real outline")).toBeInTheDocument();
    expect(screen.getByText("Real canvas")).toBeInTheDocument();
    expect(screen.getByText("Real inspector")).toBeInTheDocument();
    expect(screen.queryByText("Tree", { exact: true })).not.toBeInTheDocument();
    expect(screen.getAllByRole("separator")[0]).toHaveAttribute("aria-valuenow", "260");
    expect(screen.getAllByRole("separator")[1]).toHaveAttribute("aria-valuenow", "300");
  });

  it("lets an assembled consumer explicitly suppress the optional banner", () => {
    render(<SitemapperWorkspace toolbar={<span>Toolbar</span>} banner={null} />);
    expect(screen.queryByText("Banner", { exact: true })).not.toBeInTheDocument();
  });
});
