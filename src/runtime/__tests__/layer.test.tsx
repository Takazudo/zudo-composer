import { afterEach, expect, it } from "vitest";
import { flush, getScope, Show, signal, type Signal } from "@takazudo/zfb/zudo-react";
import { COMPOSER_LAYER_BUILD, ownLayer } from "../layer";
import { mountOwned, type OwnedRoot } from "../root";

const roots: OwnedRoot[] = [];
afterEach(() => { for (const root of roots.splice(0)) root.stop(); document.body.replaceChildren(); });

it("mounts a body-level layer on its owner's activation, keeps signals live and stops with the owner", async () => {
  const pageOpen = signal(true);
  const text = signal("first");
  let layerRoot: (() => OwnedRoot | null) | undefined;
  function Menu(props: { text: Signal<string> }) {
    return <div role="menu">{props.text}</div>;
  }
  function Toolbar() {
    layerRoot = ownLayer(getScope(), Menu, { text }).root;
    return <nav>toolbar</nav>;
  }
  function Page() {
    return <section><Show when={pageOpen}>{() => <Toolbar />}</Show></section>;
  }
  const page = mountOwned(Page, {});
  roots.push(page);
  await flush();
  const layer = document.querySelector("[data-composer-layer]")!;
  expect(layer.parentElement).toBe(document.body);
  expect(page.host.contains(layer)).toBe(false);
  expect(layerRoot?.()?.handle?.identity).toEqual({ component: "Menu", build: COMPOSER_LAYER_BUILD });
  text.value = "second";
  await flush();
  expect(layer.textContent).toBe("second");

  pageOpen.value = false;
  await flush();
  expect(document.querySelector("[data-composer-layer]")).toBeNull();
  expect(layerRoot?.()).toBeNull();
});
