import { describe, expect, it } from "vitest";
import { computed, signal, type Signal } from "@takazudo/zfb/zudo-react";
import { cleanup, fireEvent, render, screen, settle, settleTasks } from "./render";

describe("zudo-react test adapter", () => {
  it("binds @testing-library/dom queries to the root and drives a model through events and signals", async () => {
    function Rename(props: { name: Signal<string> }) {
      const empty = computed(() => props.name.value.trim() === "");
      return (
        <form>
          <label>Name <input modelValue={props.name} /></label>
          <button type="submit" disabled={empty}>Rename</button>
        </form>
      );
    }
    const name = signal("Home");
    const view = render(<Rename name={name} />);
    const input = view.getByLabelText("Name") as HTMLInputElement;
    const button = screen.getByRole("button", { name: "Rename" }) as HTMLButtonElement;
    expect(input.value).toBe("Home");
    fireEvent.input(input, { target: { value: "  " } });
    expect(name.value).toBe("  ");
    await settle();
    expect(button.disabled).toBe(true);
    name.value = "About";
    await settle();
    expect(input.value).toBe("About");
    expect(view.diagnostics).toEqual([]);
    view.unmount();
    view.unmount();
    expect(view.container.isConnected).toBe(false);
  });

  it("throws with the diagnostic codes of a refused mount", () => {
    function Broken(): never { throw new Error("boom"); }
    expect(() => render(<Broken />)).toThrow(/render: mount refused \(ZR_/);
    expect(document.querySelector("[data-zfb-island-skip-ssr]")).toBeNull();
  });

  it("settleTasks lets resolved async work land before flushing", async () => {
    const text = signal("pending");
    function Loader() {
      void Promise.resolve().then(() => new Promise((resolve) => setTimeout(resolve, 0))).then(() => { text.value = "loaded"; });
      return <p>{text}</p>;
    }
    const view = render(<Loader />);
    await settleTasks();
    await settleTasks();
    expect(view.container.textContent).toBe("loaded");
  });

  it("cleanup unmounts every rendered root", () => {
    const first = render(<p>a</p>);
    const second = render(<p>b</p>);
    cleanup();
    expect(first.container.isConnected).toBe(false);
    expect(second.container.isConnected).toBe(false);
  });

  it("is registered after each test", () => {
    expect(document.querySelectorAll("[data-zfb-island-skip-ssr]")).toHaveLength(0);
    render(<p>left for the automatic cleanup</p>);
  });

  it("left nothing behind from the previous test", () => {
    expect(document.querySelectorAll("[data-zfb-island-skip-ssr]")).toHaveLength(0);
  });
});
