import { render, screen } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import { PlaceholderBox } from "../placeholder-box";

describe("PlaceholderBox", () => {
  it("renders the label as its accessible name", () => {
    render(<PlaceholderBox label="hero-image.png" />);
    expect(screen.getByRole("img", { name: "hero-image.png" })).toBeInTheDocument();
  });

  it("falls back to alt, then src, then 'image'", () => {
    const { rerender } = render(<PlaceholderBox alt="Product photo" src="/img/product.png" />);
    expect(screen.getByRole("img", { name: "Product photo" })).toBeInTheDocument();

    rerender(<PlaceholderBox src="/img/diagram.svg" />);
    expect(screen.getByRole("img", { name: "/img/diagram.svg" })).toBeInTheDocument();

    rerender(<PlaceholderBox />);
    expect(screen.getByRole("img", { name: "image" })).toBeInTheDocument();
  });

  it("sets aspect-ratio style when aspect is provided", () => {
    render(<PlaceholderBox label="16:9" aspect="16/9" />);
    const el = screen.getByRole("img", { name: "16:9" }) as HTMLElement;
    // happy-dom normalizes the value to "16 / 9" (spaces around the slash).
    expect(el.style.aspectRatio.replace(/\s+/g, "")).toBe("16/9");
  });

  it("renders as a <span> (phrasing content, safe inside <p>)", () => {
    render(<PlaceholderBox label="hero-image.png" />);
    expect(screen.getByRole("img", { name: "hero-image.png" }).tagName).toBe("SPAN");
  });
});
