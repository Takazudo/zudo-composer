import { render, screen } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import { AutoGrid } from "../auto-grid";

describe("AutoGrid", () => {
  it("renders a <div> with its children by default", () => {
    render(
      <AutoGrid>
        <span>Item</span>
      </AutoGrid>,
    );
    const el = screen.getByText("Item").parentElement!;
    expect(el.tagName).toBe("DIV");
    expect(el.className).toContain("grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]");
  });

  it("switches to auto-fill columns when fill is set", () => {
    render(
      <AutoGrid min="13rem" fill>
        <span>Item</span>
      </AutoGrid>,
    );
    const el = screen.getByText("Item").parentElement!;
    expect(el.className).toContain("grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]");
  });

  it("renders as ul with list-none when as='ul'", () => {
    render(
      <AutoGrid as="ul">
        <li>Item</li>
      </AutoGrid>,
    );
    const el = screen.getByText("Item").parentElement!;
    expect(el.tagName).toBe("UL");
    expect(el.className).toContain("list-none");
  });
});
