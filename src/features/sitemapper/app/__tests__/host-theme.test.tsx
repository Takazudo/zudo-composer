/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import { cleanup, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, expect, it } from "vitest";
import { resolveHostTheme, useHostTheme } from "../use-host-theme";

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
