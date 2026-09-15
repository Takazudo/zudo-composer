import { render, screen } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import { SectionHeading } from "../section-heading";

describe("SectionHeading", () => {
  it("renders the heading as an <h2> by default", () => {
    render(<SectionHeading heading="Product lines" />);
    const el = screen.getByRole("heading", { level: 2 });
    expect(el).toHaveTextContent("Product lines");
  });

  it("renders as h1 when as='h1'", () => {
    render(<SectionHeading heading="Product lines" as="h1" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Product lines");
  });

  it("renders the eyebrow and intro when provided", () => {
    render(<SectionHeading eyebrow="Sustainability" heading="Title" intro="Intro copy." />);
    expect(screen.getByText("Sustainability")).toBeInTheDocument();
    expect(screen.getByText("Intro copy.")).toBeInTheDocument();
  });

  it("omits the intro paragraph when not provided", () => {
    render(<SectionHeading heading="Title" />);
    expect(screen.queryByText("Intro copy.")).not.toBeInTheDocument();
  });
});
