import { render, screen } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import { Hero } from "../hero";

describe("Hero", () => {
  it("renders the heading as an <h1>", () => {
    render(<Hero heading="Build things that last" />);
    const el = screen.getByRole("heading", { level: 1 });
    expect(el).toHaveTextContent("Build things that last");
  });

  it("renders the eyebrow and lead when provided", () => {
    render(<Hero eyebrow="Welcome" heading="Title" lead="A lead paragraph." />);
    expect(screen.getByText("Welcome")).toBeInTheDocument();
    expect(screen.getByText("A lead paragraph.")).toBeInTheDocument();
  });

  it("renders one CTA link per action", () => {
    render(
      <Hero
        heading="Title"
        actions={[
          { label: "Primary", href: "/a", variant: "primary" },
          { label: "Secondary", href: "/b", variant: "secondary" },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: /Primary/ })).toHaveAttribute("href", "/a");
    expect(screen.getByRole("link", { name: /Secondary/ })).toHaveAttribute("href", "/b");
  });

  it("applies the secondary variant's heading max-width", () => {
    render(<Hero heading="Title" variant="secondary" />);
    expect(screen.getByRole("heading", { level: 1 }).className).toContain("max-w-[24ch]");
  });
});
