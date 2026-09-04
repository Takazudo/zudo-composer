import "./cleanup";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import { ComposerIcon } from "../../icons";
import { Button } from "../button";
import { EmptyState } from "../empty-state";

describe("EmptyState", () => {
  it("states what the surface is for and offers the way in", () => {
    const onCreate = vi.fn();
    const { container } = render(
      <EmptyState
        icon={ComposerIcon}
        title="No compositions yet"
        description="Start from a blank document or a global template."
        action={
          <Button variant="primary" onClick={onCreate}>
            New composition
          </Button>
        }
      />,
    );
    expect(screen.getByText("No compositions yet")).toBeInTheDocument();
    expect(screen.getByText("Start from a blank document or a global template.")).toBeInTheDocument();
    expect(container.querySelector(".cms-empty__icon")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "New composition" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("tightens its padding in the inline variant", () => {
    const { container } = render(<EmptyState title="No matches" inline />);
    expect(container.querySelector(".cms-empty")!.className).toBe("cms-empty cms-empty--inline");
  });

  it("omits the optional slots when they are not given", () => {
    const { container } = render(<EmptyState title="No matches" />);
    expect(container.querySelector(".cms-empty__icon")).toBeNull();
    expect(container.querySelector(".cms-empty__description")).toBeNull();
    expect(container.querySelector(".cms-empty__actions")).toBeNull();
  });
});
