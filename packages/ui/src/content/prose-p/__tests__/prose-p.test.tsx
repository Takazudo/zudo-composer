import { render, screen } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import { ProseP } from "../prose-p";

describe("ProseP", () => {
  it("renders a plain paragraph", () => {
    render(<ProseP>Body copy.</ProseP>);
    expect(screen.getByText("Body copy.").tagName).toBe("P");
  });
});
