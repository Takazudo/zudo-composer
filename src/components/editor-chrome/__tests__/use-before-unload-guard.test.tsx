import "./cleanup";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/preact";
import { useBeforeUnloadGuard } from "../use-before-unload-guard";

function Guarded({ dirty }: { dirty: boolean }) {
  useBeforeUnloadGuard(dirty);
  return null;
}

function unload(): boolean {
  return !window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
}

describe("useBeforeUnloadGuard", () => {
  it("does not interfere while the record is clean", () => {
    render(<Guarded dirty={false} />);
    expect(unload()).toBe(false);
  });

  it("blocks the unload while the record is dirty", () => {
    render(<Guarded dirty />);
    expect(unload()).toBe(true);
  });

  it("stops blocking once the record is saved", () => {
    const { rerender } = render(<Guarded dirty />);
    expect(unload()).toBe(true);

    rerender(<Guarded dirty={false} />);
    expect(unload()).toBe(false);
  });

  it("detaches when the editor unmounts", () => {
    const { unmount } = render(<Guarded dirty />);
    expect(unload()).toBe(true);

    unmount();
    expect(unload()).toBe(false);
  });
});
