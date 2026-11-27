import { afterEach, expect, it } from "vitest";
import { flush, getScope, Show, signal, type Ref, type Signal } from "@takazudo/zfb/zudo-react";
import { mountOwned, type OwnedRoot } from "./support/root";
import { ownLayer } from "./support/layer";

const roots: OwnedRoot[] = [];
afterEach(() => { for (const root of roots.splice(0)) root.stop(); document.body.replaceChildren(); });

function DialogBody(props: { open: Signal<boolean>; restore: Ref<HTMLElement>; name: string; log: string[] }) {
  const scope = getScope();
  const first: Ref<HTMLInputElement> = { current: null };
  scope.onActivate(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    props.restore.current = opener;
    first.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      props.log.push(`escape ${props.name}`);
      props.open.value = false;
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      props.log.push(`closed ${props.name}`);
      // Restore only to a node that is still in the document.
      if (opener?.isConnected) opener.focus();
    };
  });
  return (
    <div role="dialog" aria-modal="true" aria-label={props.name}>
      <input ref={first} aria-label={`${props.name} name`} />
    </div>
  );
}

it("(f) an owned dialog takes focus, closes on Escape, removes its listener and restores focus", async () => {
  const open = signal(false);
  const restore: Ref<HTMLElement> = { current: null };
  const log: string[] = [];
  const opener: Ref<HTMLButtonElement> = { current: null };
  function Page() {
    return (
      <main>
        <button ref={opener} on:click={() => { open.value = true; }}>Rename</button>
        <Show when={open}>{() => <DialogBody open={open} restore={restore} name="rename" log={log} />}</Show>
      </main>
    );
  }
  roots.push(mountOwned(Page, {}));
  opener.current!.focus();
  opener.current!.click();
  await flush();
  expect(document.activeElement?.getAttribute("aria-label")).toBe("rename name");
  expect(restore.current).toBe(opener.current);

  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  await flush();
  expect(document.querySelector("[role=dialog]")).toBeNull();
  expect(document.activeElement).toBe(opener.current);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(log).toEqual(["escape rename", "closed rename"]);
});

it("(f) a body-level layer root is owned by its opener and disposed with it", async () => {
  const pageOpen = signal(true);
  const menuOpen = signal(true);
  const restore: Ref<HTMLElement> = { current: null };
  const log: string[] = [];
  function Menu(props: { open: Signal<boolean> }) {
    return <Show when={props.open}>{() => <DialogBody open={props.open} restore={restore} name="menu" log={log} />}</Show>;
  }
  function Toolbar() {
    ownLayer(getScope(), Menu, { open: menuOpen });
    return <nav style={{ overflow: "hidden", "max-height": "2rem" }}><button>Insert</button></nav>;
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
  expect(layer.querySelector("[role=dialog]")).not.toBeNull();

  // Closing the owner removes the layer root and its document listener.
  pageOpen.value = false;
  await flush();
  expect(document.querySelector("[data-composer-layer]")).toBeNull();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(log).toEqual(["closed menu"]);
});
