import { render, screen } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import { Callout, Note } from "../callout";

describe("Callout", () => {
  it("renders its children with role=note", () => {
    render(<Callout>Content</Callout>);
    expect(screen.getByRole("note")).toHaveTextContent("Content");
  });

  it("renders the title when provided", () => {
    render(<Callout title="Heads up">Content</Callout>);
    expect(screen.getByText("Heads up")).toBeInTheDocument();
  });

  it("omits the title row when not provided", () => {
    render(<Callout>Content</Callout>);
    expect(screen.queryByText("Heads up")).not.toBeInTheDocument();
  });

  it("defaults to the note tone", () => {
    render(<Callout title="Heads up">Content</Callout>);
    expect(screen.getByText("Heads up").className).toContain("text-accent");
  });

  it("applies the muted tone's title class", () => {
    render(
      <Callout tone="muted" title="Heads up">
        Content
      </Callout>,
    );
    expect(screen.getByText("Heads up").className).toContain("text-fg");
  });
});

describe("Note", () => {
  it("is a tone=note alias of Callout", () => {
    render(<Note title="Heads up">Content</Note>);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("Content");
    expect(screen.getByText("Heads up").className).toContain("text-accent");
  });
});
