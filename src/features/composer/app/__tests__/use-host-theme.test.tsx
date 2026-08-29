/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../test-support/cleanup";
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/preact";
import { resolveHostTheme, useHostTheme } from "../use-host-theme";

afterEach(() => document.documentElement.removeAttribute("data-theme"));

describe("resolveHostTheme (#251)", () => {
  it("reads data-theme=dark as dark, everything else as light", () => {
    const dark = document.createElement("html");
    dark.setAttribute("data-theme", "dark");
    expect(resolveHostTheme(dark)).toBe("dark");

    const light = document.createElement("html");
    light.setAttribute("data-theme", "light");
    expect(resolveHostTheme(light)).toBe("light");

    expect(resolveHostTheme(document.createElement("html"))).toBe("light");
    expect(resolveHostTheme(null)).toBe("light");
  });
});

function Probe() {
  const theme = useHostTheme();
  return <span data-testid="theme">{theme}</span>;
}

describe("useHostTheme (#251)", () => {
  it("tracks the host <html data-theme> and updates when it toggles", async () => {
    document.documentElement.setAttribute("data-theme", "light");
    render(<Probe />);
    expect(screen.getByTestId("theme").textContent).toBe("light");

    document.documentElement.setAttribute("data-theme", "dark");
    await waitFor(() => expect(screen.getByTestId("theme").textContent).toBe("dark"));
  });
});
