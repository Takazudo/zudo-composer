import { afterEach, describe, expect, it, vi } from "vitest";
import { computed, flush, getScope, Show, signal } from "@takazudo/zfb/zudo-react";
import { COMPOSER_ROOT_BUILD, createOwnedRootHost, mountOwned, mountOwnedChild, type OwnedRoot } from "../root";

const roots: OwnedRoot[] = [];
afterEach(() => { for (const root of roots.splice(0)) root.stop(); document.body.replaceChildren(); });

describe("owned roots", () => {
  it("creates a connected host carrying the zudo-react/1 skip-SSR wrapper contract", () => {
    const parent = document.createElement("section");
    document.body.append(parent);
    const host = createOwnedRootHost({ component: "Panel", build: "b1" }, parent);
    expect(host.parentElement).toBe(parent);
    expect(Object.fromEntries([...host.attributes].map((attribute) => [attribute.name, attribute.value]))).toEqual({
      "data-zfb-island-skip-ssr": "Panel",
      "data-zfb-transport": "json/1",
      "data-zfb-protocol": "zudo-react/1",
      "data-zfb-build": "b1",
    });
  });

  it("mounts a component by its name, updates through signals and stops idempotently", async () => {
    const label = signal("one");
    const events: string[] = [];
    function Panel(props: { label: typeof label }) {
      getScope().onCleanup(() => events.push("cleanup"));
      return <p>{props.label}</p>;
    }
    const root = mountOwned(Panel, { label });
    roots.push(root);
    expect(root.handle?.identity).toEqual({ component: "Panel", build: COMPOSER_ROOT_BUILD });
    expect(root.host.getAttribute("data-zfb-island-skip-ssr")).toBe("Panel");
    const paragraph = root.host.querySelector("p")!;
    label.value = "two";
    await flush();
    expect(root.host.querySelector("p")).toBe(paragraph);
    expect(paragraph.textContent).toBe("two");
    root.stop();
    root.stop();
    expect(root.host.isConnected).toBe(false);
    expect(events).toEqual(["cleanup"]);
  });

  it("requires an identity for an anonymous component and honours an explicit name and build", () => {
    const anonymous = [() => <p>x</p>][0]!;
    expect(() => mountOwned(anonymous, {})).toThrow(/explicit `name`/);
    const root = mountOwned(anonymous, {}, { name: "Named", build: "layer" });
    roots.push(root);
    expect(root.handle?.identity).toEqual({ component: "Named", build: "layer" });
  });

  it("reports a refused mount with a null handle and its diagnostics", () => {
    const reported: string[] = [];
    function Broken(): never { throw new Error("setup failed"); }
    const root = mountOwnedChild(<Broken />, { identity: { component: "Broken", build: "b" }, report: (diagnostic) => reported.push(diagnostic.code) });
    roots.push(root);
    expect(root.handle).toBeNull();
    expect(root.diagnostics.length).toBeGreaterThan(0);
    expect(reported).toEqual(root.diagnostics.map((diagnostic) => diagnostic.code));
  });

  it("cancels a mount whose signal is already aborted", () => {
    const controller = new AbortController();
    controller.abort();
    const root = mountOwned(function Panel() { return <p>never</p>; }, {}, { signal: controller.signal });
    roots.push(root);
    expect(root.handle).toBeNull();
    expect(root.diagnostics.map((diagnostic) => diagnostic.code)).toContain("ZR_CANCELLED");
  });

  // Without an explicit reporter an update-phase failure must stay visible:
  // the zudo-react default logs it, so a root Composer owns does too.
  it("logs an update-phase diagnostic to the console when no reporter is given", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const open = signal(false);
      function Panel() {
        return <Show when={open}>{() => <select><option>{computed(() => "a")}{"b"}</option></select>}</Show>;
      }
      const root = mountOwned(Panel, {});
      roots.push(root);
      open.value = true;
      await flush();
      expect(root.diagnostics.map((diagnostic) => diagnostic.code)).toContain("ZR_SUBSCRIBER_ERROR");
      expect(errors).toHaveBeenCalledWith(expect.stringMatching(/^ZR_SUBSCRIBER_ERROR at .*\(Panel, update\)/), expect.objectContaining({ code: "ZR_SUBSCRIBER_ERROR" }));
    } finally {
      errors.mockRestore();
    }
  });
});
