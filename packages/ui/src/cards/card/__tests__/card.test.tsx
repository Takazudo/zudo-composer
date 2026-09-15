import { render, screen } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import { Card } from "../card";

describe("Card", () => {
  it("renders its children", () => {
    render(<Card>Content</Card>);
    expect(screen.getByText("Content")).toBeInTheDocument();
  });

  it("renders the title prop through Card.Title", () => {
    render(<Card title="Heading">Content</Card>);
    const heading = screen.getByRole("heading", { level: 3 });
    expect(heading).toHaveTextContent("Heading");
  });

  it("defaults to the default variant", () => {
    render(<Card>Content</Card>);
    expect(screen.getByText("Content").parentElement!.className).toContain("bg-bg");
  });

  it("maps the accent variant to a top accent rule", () => {
    render(<Card variant="accent">Content</Card>);
    expect(screen.getByText("Content").parentElement!.className).toContain("border-t-accent");
  });

  it("maps the muted variant to the surface tint", () => {
    render(<Card variant="muted">Content</Card>);
    expect(screen.getByText("Content").parentElement!.className).toContain("bg-surface");
  });

  it("exposes Card.Title as a standalone export", () => {
    render(
      <Card>
        <Card.Title>Explicit title</Card.Title>
      </Card>,
    );
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Explicit title");
  });
});
