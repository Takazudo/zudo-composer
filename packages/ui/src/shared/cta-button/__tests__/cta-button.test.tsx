import { render, screen } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import { CtaButton } from "../cta-button";

describe("CtaButton", () => {
  it("renders an <a> with the given href", () => {
    render(<CtaButton href="/products">Browse</CtaButton>);
    const el = screen.getByRole("link", { name: /Browse/ });
    expect(el).toHaveAttribute("href", "/products");
  });

  it("defaults to the primary variant with a trailing arrow", () => {
    render(<CtaButton href="/products">Browse</CtaButton>);
    const el = screen.getByRole("link");
    expect(el.className).toContain("bg-accent");
    expect(el.textContent).toContain("→");
  });

  it("applies the secondary variant classes", () => {
    render(
      <CtaButton href="/company" variant="secondary">
        Company
      </CtaButton>,
    );
    expect(screen.getByRole("link").className).toContain("text-accent");
  });

  it("omits the arrow glyph when arrow=false", () => {
    render(
      <CtaButton href="/products" arrow={false}>
        Browse
      </CtaButton>,
    );
    expect(screen.getByRole("link").textContent).not.toContain("→");
  });
});
