import "./cleanup";
import { computed, signal } from "@takazudo/zfb/zudo-react";
import { fireEvent, render, screen, settle } from "../../../test/render";
import { expect, it, vi } from "vitest";
import { DisclosureButton } from "../disclosure-button";

it("shares button refs and ARIA while rendering square plus/minus rather than directional arrows", async () => {
  const ref = { current: null as HTMLButtonElement | null };
  const click = vi.fn();
  const expanded = signal(false);
  render(<DisclosureButton expanded={expanded} aria-label={computed(() => (expanded.value ? "Collapse navigation" : "Expand navigation"))} elementRef={ref} on:click={click} />);
  const button = screen.getByRole("button", { name: "Expand navigation" });
  expect(ref.current).toBe(button);
  expect(button).toHaveAttribute("aria-expanded", "false");
  expect(button.querySelector("rect")).not.toBeNull();
  expect(button.querySelectorAll("path")).toHaveLength(2);
  fireEvent.click(button);
  expect(click).toHaveBeenCalledOnce();
  expanded.value = true;
  await settle();
  expect(screen.getByRole("button", { name: "Collapse navigation" })).toBe(button);
  expect(button).toHaveAttribute("aria-expanded", "true");
  expect(button.querySelectorAll("path")).toHaveLength(1);
});
