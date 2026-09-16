import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installVisitorNavigation } from "../visitor-navigation";
import type { DeliveryBasePath } from "../routing";

const ROUTES = ["/", "/about", "/journal/entry"];

let uninstall: (() => void) | undefined;
let mount: ReturnType<typeof vi.fn<() => void>>;

function install(basePath: DeliveryBasePath, at: string): void {
  window.history.replaceState(null, "", at);
  uninstall = installVisitorNavigation({ routes: ROUTES, basePath, mount });
}

/** Reports whether the installed handler took the click over, without letting an
 *  untaken one reach jsdom's unimplemented navigation. */
function click(href: string, attributes: Record<string, string> = {}, init: MouseEventInit = {}): boolean {
  const anchor = document.createElement("a");
  anchor.setAttribute("href", href);
  for (const [name, value] of Object.entries(attributes)) anchor.setAttribute(name, value);
  document.body.append(anchor);
  let handled = false;
  window.addEventListener("click", (event) => { handled = event.defaultPrevented; event.preventDefault(); }, { once: true });
  anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init }));
  return handled;
}

beforeEach(() => {
  mount = vi.fn<() => void>();
  vi.stubGlobal("scrollTo", vi.fn());
});
afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

describe("visitor navigation", () => {
  it.each([
    ["/" as const, "/", "/about", "/journal/entry"],
    ["/site" as const, "/site", "/site/about", "/site/journal/entry"],
    ["/website-preview" as const, "/website-preview", "/website-preview/about", "/website-preview/journal/entry"],
  ])("takes over compiled routes under %s", (basePath, home, about, nested) => {
    install(basePath, home);
    expect(click(about)).toBe(true);
    expect(window.location.pathname).toBe(about);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(click(nested)).toBe(true);
    expect(window.location.pathname).toBe(nested);
    expect(click(home)).toBe(true);
    expect(window.location.pathname).toBe(home);
    expect(mount).toHaveBeenCalledTimes(3);
  });

  it.each(["/" as const, "/site" as const, "/website-preview" as const])("re-mounts on history traversal under %s", async (basePath) => {
    install(basePath, basePath);
    click(`${basePath === "/" ? "" : basePath}/about`);
    mount.mockClear();
    window.history.back();
    await vi.waitFor(() => expect(mount).toHaveBeenCalled());
  });

  it("leaves the current address to the browser without a duplicate history entry", () => {
    install("/website-preview", "/website-preview/about");
    const length = window.history.length;
    expect(click("/website-preview/about")).toBe(true);
    expect(mount).not.toHaveBeenCalled();
    expect(window.history.length).toBe(length);
  });

  it.each([
    ["a query string", "/website-preview/about?draft=1"],
    ["a hash", "/website-preview/about#part"],
    ["a trailing slash", "/website-preview/about/"],
    ["an uncompiled route", "/website-preview/missing"],
    ["an uploaded asset", "/uploaded-assets/logo.png"],
    ["an editor route", "/composer"],
    ["another origin", "https://example.com/website-preview/about"],
  ])("leaves %s to the browser", (_case, href) => {
    install("/website-preview", "/website-preview");
    expect(click(href)).toBe(false);
    expect(mount).not.toHaveBeenCalled();
  });

  it.each([
    ["a new-tab anchor", { target: "_blank" }],
    ["a download anchor", { download: "" }],
  ])("leaves %s to the browser", (_case, attributes) => {
    install("/website-preview", "/website-preview");
    expect(click("/website-preview/about", attributes)).toBe(false);
    expect(mount).not.toHaveBeenCalled();
  });

  it.each([
    ["a middle click", { button: 1 }],
    ["a meta click", { metaKey: true }],
    ["a ctrl click", { ctrlKey: true }],
    ["a shift click", { shiftKey: true }],
    ["an alt click", { altKey: true }],
  ] as const)("leaves %s to the browser", (_case, init) => {
    install("/website-preview", "/website-preview");
    expect(click("/website-preview/about", {}, init)).toBe(false);
    expect(mount).not.toHaveBeenCalled();
  });

  it("stops handling clicks and traversal once uninstalled", async () => {
    install("/website-preview", "/website-preview");
    uninstall!();
    uninstall = undefined;
    expect(click("/website-preview/about")).toBe(false);
    expect(mount).not.toHaveBeenCalled();
  });
});
