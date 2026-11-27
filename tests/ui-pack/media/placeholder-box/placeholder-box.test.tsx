import { signal } from "@takazudo/zfb/zudo-react";
import { Keyed } from "../../../../src/runtime";
import { render, screen, settleTasks } from "../../../../src/test/render";
import { describe, expect, it } from "vitest";
import { PlaceholderBox, type PlaceholderBoxProps } from "../../../../packages/ui/src/media/placeholder-box/placeholder-box";

describe("PlaceholderBox", () => {
  it("renders the label as its accessible name", () => {
    render(<PlaceholderBox label="hero-image.png" />);
    expect(screen.getByRole("img", { name: "hero-image.png" })).toBeInTheDocument();
  });

  it("falls back to alt, then src, then 'image'", async () => {
    // A prop change remounts the node, as the Composer preview renderer does.
    const props = signal<PlaceholderBoxProps>({ alt: "Product photo", src: "/img/product.png" });
    render(
      <Keyed value={props} by={(value) => JSON.stringify(value)}>
        {(value) => <PlaceholderBox {...value.value} />}
      </Keyed>,
    );
    expect(screen.getByRole("img", { name: "Product photo" })).toBeInTheDocument();

    props.value = { src: "/img/diagram.svg" };
    await settleTasks();
    expect(screen.getByRole("img", { name: "/img/diagram.svg" })).toBeInTheDocument();

    props.value = {};
    await settleTasks();
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
