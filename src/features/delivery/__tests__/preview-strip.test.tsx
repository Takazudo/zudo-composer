import { cleanup, fireEvent, render } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import type { SiteCompiledRoute } from "../../../site-project/compiler";
import { PreviewStrip, PREVIEW_PENDING_COPY, PREVIEW_REFRESHING_COPY, type PreviewStripProps } from "../preview-strip";

afterEach(cleanup);

/** The picker reads only `pathname` and `displayTitle`; the rest of a compiled route is irrelevant here. */
const route = (pathname: string, displayTitle: string): SiteCompiledRoute =>
  ({ pathname, displayTitle }) as unknown as SiteCompiledRoute;
const ROUTES = [route("/", "Home"), route("/about", "About")];

/** The strip renders into an open shadow root, so Testing Library queries cannot reach it. */
function mount(props: Partial<PreviewStripProps> = {}): ShadowRoot {
  render(<PreviewStrip label="Live working preview — not activated" basePath="/website-preview" pathname="/website-preview" hostedDemo={false} {...props} />);
  return document.querySelector(".zc-preview-strip")!.shadowRoot!;
}
const status = (shadow: ShadowRoot): HTMLElement | null => shadow.querySelector<HTMLElement>("[role='status']");

describe("PreviewStrip", () => {
  it("carries its label and offers no picker before a build is ready", () => {
    const shadow = mount({ label: "Activated local release — not deployed", basePath: "/site", pathname: "/site" });
    expect(shadow.textContent).toContain("Activated local release — not deployed");
    expect(shadow.querySelector("select")).toBeNull();
  });

  it("offers every compiled route and navigates in place rather than reloading", () => {
    const shadow = mount({ routes: ROUTES, basePath: "/site", pathname: "/site" });
    const picker = shadow.querySelector("select")!;
    expect([...picker.options].map(({ value, text }) => [value, text])).toEqual([["/site", "Home"], ["/site/about", "About"]]);
    expect(picker).toHaveValue("/site");
    fireEvent.change(picker, { target: { value: "/site/about" } });
    expect(window.location.pathname).toBe("/site/about");
  });

  it("reports nothing about freshness for an activated release", () => {
    const shadow = mount({ label: "Activated local release — not deployed", basePath: "/site", pathname: "/site", routes: ROUTES });
    expect(status(shadow)).toBeNull();
    expect(shadow.textContent).not.toContain(PREVIEW_PENDING_COPY);
    expect(shadow.textContent).not.toContain(PREVIEW_REFRESHING_COPY);
  });

  it("keeps one polite live region mounted for the working preview even while it has nothing to say", () => {
    const shadow = mount({ pending: false, refreshing: false });
    const region = status(shadow)!;
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region.textContent).toBe("");
    expect(shadow.querySelectorAll("[role='status']")).toHaveLength(1);
  });

  it("names the editor's unsaved changes, and an update in flight ahead of them", () => {
    expect(status(mount({ pending: true, refreshing: false }))!.textContent).toBe(PREVIEW_PENDING_COPY);
    cleanup();
    expect(status(mount({ pending: false, refreshing: true }))!.textContent).toBe(PREVIEW_REFRESHING_COPY);
    cleanup();
    expect(status(mount({ pending: true, refreshing: true }))!.textContent).toBe(PREVIEW_REFRESHING_COPY);
  });

  it("reports a failed re-capture ahead of every other freshness message", () => {
    const shadow = mount({ pending: true, refreshing: true, error: "The live working draft could not be loaded. offline" });
    expect(status(shadow)!.textContent).toBe("The live working draft could not be loaded. offline");
    expect(shadow.textContent).not.toContain(PREVIEW_REFRESHING_COPY);
  });

  it("keeps the hosted demo notice independent of the freshness region", () => {
    const shadow = mount({ hostedDemo: true, pending: true });
    expect(shadow.textContent).toContain("Public demo of zudo-composer");
    expect(status(shadow)!.textContent).toBe(PREVIEW_PENDING_COPY);
  });
});
