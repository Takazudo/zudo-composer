import "./cleanup";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/preact";
import { Chip } from "../chip";

describe("Chip", () => {
  it("renders the bordered neutral tone by default", () => {
    render(<Chip>Draft</Chip>);
    expect(screen.getByText("Draft").className).toBe("cms-chip");
  });

  it("applies one class per tone", () => {
    const { container } = render(
      <>
        <Chip tone="ok">Ok</Chip>
        <Chip tone="warn">Warn</Chip>
        <Chip tone="err">Err</Chip>
        <Chip tone="accent">Accent</Chip>
        <Chip tone="plain">Plain</Chip>
      </>,
    );
    const classes = [...container.querySelectorAll("span.cms-chip")].map((chip) => chip.className);
    expect(classes).toEqual([
      "cms-chip cms-chip--ok",
      "cms-chip cms-chip--warn",
      "cms-chip cms-chip--err",
      "cms-chip cms-chip--accent",
      "cms-chip cms-chip--plain",
    ]);
  });

  it("adds a decorative leading dot only when asked", () => {
    const { container, rerender } = render(<Chip tone="ok">Published</Chip>);
    expect(container.querySelector(".cms-chip__dot")).toBeNull();
    rerender(
      <Chip tone="ok" dot>
        Published
      </Chip>,
    );
    const dot = container.querySelector(".cms-chip__dot");
    expect(dot).not.toBeNull();
    expect(dot).toHaveAttribute("aria-hidden", "true");
  });
});
