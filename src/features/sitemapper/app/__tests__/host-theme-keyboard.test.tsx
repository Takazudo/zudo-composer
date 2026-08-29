/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import { cleanup, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, expect, it, vi } from "vitest";
import { resolveHostTheme, useHostTheme } from "../use-host-theme";
import {
  isSitemapperEditableEventTarget,
  useSitemapperKeyboard,
  type KeyboardHost,
} from "../use-sitemapper-keyboard";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
});

it("mirrors data-theme changes from the host", async () => {
  function Probe() { return <span data-testid="theme">{useHostTheme()}</span>; }
  document.documentElement.setAttribute("data-theme", "light");
  render(<Probe />);
  document.documentElement.setAttribute("data-theme", "dark");
  await waitFor(() => expect(screen.getByTestId("theme")).toHaveTextContent("dark"));
  expect(resolveHostTheme()).toBe("dark");
});

it("guards Escape and removal shortcuts while typing in editable targets", () => {
  let listener: ((event: KeyboardEvent) => void) | undefined;
  const host: KeyboardHost = {
    addEventListener: (_type, value) => { listener = value; },
    removeEventListener: () => { listener = undefined; },
  };
  const remove = vi.fn();
  const escape = vi.fn();
  function Probe() {
    useSitemapperKeyboard({ selectedId: "page", onRemoveSelected: remove, onEscape: escape, host });
    return null;
  }
  render(<Probe />);
  listener?.({ key: "Delete", target: { tagName: "INPUT", isContentEditable: false } } as never);
  listener?.({ key: "Escape", target: { tagName: "TEXTAREA", isContentEditable: false } } as never);
  expect(remove).not.toHaveBeenCalled();
  expect(escape).not.toHaveBeenCalled();
  expect(isSitemapperEditableEventTarget({ tagName: "DIV", isContentEditable: true } as never)).toBe(true);

  const preventDefault = vi.fn();
  listener?.({ key: "Backspace", target: { tagName: "BODY", isContentEditable: false }, preventDefault } as never);
  expect(remove).toHaveBeenCalledWith("page");
  expect(preventDefault).toHaveBeenCalled();
});
