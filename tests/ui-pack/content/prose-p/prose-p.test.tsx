import { render, screen } from "../../../../src/test/render";
import { describe, expect, it } from "vitest";
import { ProseP } from "../../../../packages/ui/src/content/prose-p/prose-p";

describe("ProseP", () => {
  it("renders a plain paragraph", () => {
    render(<ProseP>Body copy.</ProseP>);
    expect(screen.getByText("Body copy.").tagName).toBe("P");
  });
});
