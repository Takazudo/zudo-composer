import "./cleanup";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import { PlusIcon } from "../../icons";
import { Button } from "../button";

describe("Button", () => {
  it("defaults to a non-submitting button at the 30px md size", () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveAttribute("type", "button");
    expect(button.className).toBe("cms-btn");
  });

  it("applies one class per variant", () => {
    const { container } = render(
      <>
        <Button variant="primary">Primary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
      </>,
    );
    const classes = [...container.querySelectorAll("button")].map((button) => button.className);
    expect(classes).toEqual(["cms-btn cms-btn--primary", "cms-btn cms-btn--ghost", "cms-btn cms-btn--danger"]);
  });

  it("applies the size ladder, leaving md unmodified", () => {
    const { container } = render(
      <>
        <Button size="xs">Extra small</Button>
        <Button size="sm">Small</Button>
        <Button size="md">Medium</Button>
      </>,
    );
    const classes = [...container.querySelectorAll("button")].map((button) => button.className);
    expect(classes).toEqual(["cms-btn cms-btn--xs", "cms-btn cms-btn--sm", "cms-btn"]);
  });

  it("names an icon-only button from aria-label", () => {
    render(
      <Button iconOnly aria-label="Add component">
        <PlusIcon size="sm" />
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Add component" });
    expect(button.className).toContain("cms-btn--icon");
  });

  it("exposes a pressed toggle state", () => {
    render(
      <Button aria-pressed={true}>
        Show slug
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Show slug", pressed: true })).toBeInTheDocument();
  });

  it("marks the disabled state on the element itself, so the platform blocks activation", () => {
    // jsdom's fireEvent dispatches straight at the node and does not model the
    // browser's disabled-activation filter, so the attribute is the contract.
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Delete
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  it("fires onClick when enabled", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Duplicate</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
