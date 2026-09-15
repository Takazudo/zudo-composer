import { render, screen } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import { SplitLayout } from "../split-layout";

describe("SplitLayout", () => {
  it("renders left and right content", () => {
    render(<SplitLayout left={<span>Left</span>} right={<span>Right</span>} />);
    expect(screen.getByText("Left")).toBeInTheDocument();
    expect(screen.getByText("Right")).toBeInTheDocument();
  });

  it("renders multiple ordered right-slot children in order", () => {
    render(
      <SplitLayout
        left={<span>Left</span>}
        right={
          <>
            <span>First</span>
            <span>Second</span>
          </>
        }
      />,
    );
    const rightPane = screen.getByText("Left").parentElement!.nextElementSibling as HTMLElement;
    expect(rightPane.textContent).toBe("FirstSecond");
  });

  it("stacks in a column by default and switches to a row at md", () => {
    render(<SplitLayout left={<span>Left</span>} right={<span>Right</span>} />);
    const root = screen.getByText("Left").parentElement!.parentElement!;
    expect(root.className).toContain("flex-col");
    expect(root.className).toContain("md:flex-row");
  });

  it("applies the ratio's flex-grow classes to left/right panes", () => {
    render(<SplitLayout ratio="60/40" left={<span>Left</span>} right={<span>Right</span>} />);
    expect(screen.getByText("Left").parentElement!.className).toContain("md:flex-[3_1_0%]");
    expect(screen.getByText("Right").parentElement!.className).toContain("md:flex-[2_1_0%]");
  });

  it("defaults to an even 50/50 split", () => {
    render(<SplitLayout left={<span>Left</span>} right={<span>Right</span>} />);
    expect(screen.getByText("Left").parentElement!.className).toContain("md:flex-1");
    expect(screen.getByText("Right").parentElement!.className).toContain("md:flex-1");
  });

  it("applies min-w-0 to both panes to prevent overflow", () => {
    render(<SplitLayout left={<span>Left</span>} right={<span>Right</span>} />);
    expect(screen.getByText("Left").parentElement!.className).toContain("min-w-0");
    expect(screen.getByText("Right").parentElement!.className).toContain("min-w-0");
  });

  it("applies the gap classes for both axes", () => {
    render(<SplitLayout gap="lg" left={<span>Left</span>} right={<span>Right</span>} />);
    const root = screen.getByText("Left").parentElement!.parentElement!;
    expect(root.className).toContain("gap-x-hsp-2xl");
    expect(root.className).toContain("gap-y-vsp-xl");
  });

  it("renders the given `as` tag", () => {
    render(<SplitLayout as="section" left={<span>Left</span>} right={<span>Right</span>} />);
    expect(screen.getByText("Left").parentElement!.parentElement!.tagName).toBe("SECTION");
  });
});
