import { render, screen } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import { Stack } from "../stack";

describe("Stack", () => {
  it("renders a <div> with its children, stacked vertically by default", () => {
    render(
      <Stack>
        <span>First</span>
        <span>Second</span>
      </Stack>,
    );
    const el = screen.getByText("First").parentElement!;
    expect(el.tagName).toBe("DIV");
    expect(el.className).toContain("flex-col");
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("switches to a horizontal row that wraps (never forces overflow)", () => {
    render(
      <Stack direction="horizontal">
        <span>A</span>
      </Stack>,
    );
    const el = screen.getByText("A").parentElement!;
    expect(el.className).toContain("flex-row");
    expect(el.className).toContain("flex-wrap");
  });

  it("applies the vertical gap class by default", () => {
    render(
      <Stack gap="lg">
        <span>Item</span>
      </Stack>,
    );
    expect(screen.getByText("Item").parentElement!.className).toContain("gap-y-vsp-lg");
  });

  it("applies the horizontal gap class when direction=horizontal", () => {
    render(
      <Stack direction="horizontal" gap="lg">
        <span>Item</span>
      </Stack>,
    );
    expect(screen.getByText("Item").parentElement!.className).toContain("gap-x-hsp-lg");
  });

  it("applies align/justify classes", () => {
    render(
      <Stack align="center" justify="between">
        <span>Item</span>
      </Stack>,
    );
    const el = screen.getByText("Item").parentElement!;
    expect(el.className).toContain("items-center");
    expect(el.className).toContain("justify-between");
  });

  it("renders the given `as` tag", () => {
    render(
      <Stack as="section">
        <span>Item</span>
      </Stack>,
    );
    expect(screen.getByText("Item").parentElement!.tagName).toBe("SECTION");
  });
});
