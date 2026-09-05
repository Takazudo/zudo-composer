import "./cleanup";
import { fireEvent, render, screen } from "@testing-library/preact";
import { expect, it, vi } from "vitest";
import { DisclosureButton } from "../disclosure-button";

it("shares button refs and ARIA while rendering square plus/minus rather than directional arrows", () => {
  const ref = { current: null as HTMLButtonElement | null };
  const click = vi.fn();
  const { rerender } = render(<DisclosureButton expanded={false} aria-label="Expand navigation" elementRef={ref} onClick={click} />);
  const button = screen.getByRole("button", { name: "Expand navigation" });
  expect(ref.current).toBe(button);
  expect(button).toHaveAttribute("aria-expanded", "false");
  expect(button.querySelector("rect")).not.toBeNull();
  expect(button.querySelectorAll("path")).toHaveLength(2);
  fireEvent.click(button);
  expect(click).toHaveBeenCalledOnce();
  rerender(<DisclosureButton expanded aria-label="Collapse navigation" />);
  expect(button).toHaveAttribute("aria-expanded", "true");
  expect(button.querySelectorAll("path")).toHaveLength(1);
});
