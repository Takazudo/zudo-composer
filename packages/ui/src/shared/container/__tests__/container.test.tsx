import { render, screen } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import { Container } from "../container";

describe("Container", () => {
  it("renders a <div> with its children by default", () => {
    render(
      <Container>
        <span>Content</span>
      </Container>,
    );
    const el = screen.getByText("Content").parentElement!;
    expect(el.tagName).toBe("DIV");
    expect(el.className).toContain("max-w-[88rem]");
  });

  it("renders the given `as` tag", () => {
    render(
      <Container as="section">
        <span>Content</span>
      </Container>,
    );
    expect(screen.getByText("Content").parentElement!.tagName).toBe("SECTION");
  });

  it("centers via inline marginInline:auto", () => {
    render(
      <Container>
        <span>Content</span>
      </Container>,
    );
    const el = screen.getByText("Content").parentElement as HTMLElement;
    expect(el.style.marginInline).toBe("auto");
  });
});
