import "./cleanup";
import { describe, expect, it } from "vitest";
import { getScope, signal, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import { render, settle } from "../../../test/render";
import { guardBeforeUnload } from "../use-before-unload-guard";

function Guarded({ dirty }: { dirty: boolean | ReadonlySignal<boolean> }) {
  guardBeforeUnload(getScope(), dirty);
  return null;
}

function unload(): boolean {
  return !window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
}

describe("guardBeforeUnload", () => {
  it("does not interfere while the record is clean", async () => {
    render(<Guarded dirty={false} />);
    await settle();
    expect(unload()).toBe(false);
  });

  it("blocks the unload while the record is dirty", async () => {
    render(<Guarded dirty />);
    await settle();
    expect(unload()).toBe(true);
  });

  it("stops blocking once the record is saved", async () => {
    const dirty = signal(true);
    render(<Guarded dirty={dirty} />);
    await settle();
    expect(unload()).toBe(true);

    dirty.value = false;
    await settle();
    expect(unload()).toBe(false);
  });

  it("detaches when the editor unmounts", async () => {
    const { unmount } = render(<Guarded dirty />);
    await settle();
    expect(unload()).toBe(true);

    unmount();
    expect(unload()).toBe(false);
  });
});
