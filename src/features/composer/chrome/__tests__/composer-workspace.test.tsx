/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../test-support/cleanup";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/preact";
import { ComposerWorkspace } from "../composer-workspace";

const BACK = { href: "/composer#/", label: "Back to Compositions" };

describe("ComposerWorkspace", () => {
  it("renders the shared editor chrome: back link, title, and both rail separators", () => {
    render(<ComposerWorkspace back={BACK} title={<span>Product overview</span>} />);
    expect(screen.getByRole("link", { name: "Back to Compositions" })).toBeInTheDocument();
    expect(screen.getByText("Product overview")).toBeInTheDocument();
    expect(screen.getByRole("separator", { name: "Resize Structure" })).toBeInTheDocument();
    expect(screen.getByRole("separator", { name: "Resize Inspector" })).toBeInTheDocument();
  });

  it("names its three panes on the narrow-screen switch", () => {
    render(<ComposerWorkspace back={BACK} title={<span>Product overview</span>} />);
    const radios = within(screen.getByRole("radiogroup", { name: "Pane" })).getAllByRole("radio");
    expect(radios.map((radio) => radio.textContent)).toEqual(["Structure", "Canvas", "Inspect"]);
  });

  it("defaults every region to a labelled placeholder", () => {
    render(<ComposerWorkspace back={BACK} title={<span>Product overview</span>} />);
    expect(screen.getByText("No structure surface was supplied.")).toBeInTheDocument();
    expect(screen.getByText("No preview surface was supplied.")).toBeInTheDocument();
    expect(screen.getByText("No inspector surface was supplied.")).toBeInTheDocument();
  });

  it("accepts typed slot overrides for tree/canvas/inspector without any other change", () => {
    render(
      <ComposerWorkspace
        back={BACK}
        title={<span>Product overview</span>}
        tree={<div>Real tree</div>}
        canvas={<div>Real canvas</div>}
        inspector={<div>Real inspector</div>}
      />,
    );
    expect(screen.getByText("Real tree")).toBeInTheDocument();
    expect(screen.getByText("Real canvas")).toBeInTheDocument();
    expect(screen.getByText("Real inspector")).toBeInTheDocument();
    expect(screen.queryByText("No structure surface was supplied.")).not.toBeInTheDocument();
  });

  it("renders the banner above the canvas, inside the main region", () => {
    const { container } = render(
      <ComposerWorkspace
        back={BACK}
        title={<span>Product overview</span>}
        banner={<div>Recovered notice</div>}
        canvas={<div>Real canvas</div>}
      />,
    );
    const main = container.querySelector(".sg-composer-main")!;
    expect(main.textContent).toBe("Recovered noticeReal canvas");
    // The banner slot is always a real element, so the canvas keeps the second
    // grid row and its full height whether or not there is a banner.
    expect(main.firstElementChild).toHaveClass("sg-composer-main__banner");
  });

  it("hands the toolbar a rail toggle, which collapses the region it names", () => {
    const { container } = render(
      <ComposerWorkspace
        back={BACK}
        title={<span>Product overview</span>}
        right={({ toggleRail }) => (
          <button type="button" onClick={() => toggleRail("nav")}>
            Toggle structure
          </button>
        )}
        tree={<div>Real tree</div>}
      />,
    );
    expect(container.querySelector(".cms-editor__body")).not.toHaveClass("nav-collapsed");
    fireEvent.click(screen.getByRole("button", { name: "Toggle structure" }));
    expect(container.querySelector(".cms-editor__body")).toHaveClass("nav-collapsed");
  });
});
