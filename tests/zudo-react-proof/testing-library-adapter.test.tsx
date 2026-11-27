import { afterEach, expect, it } from "vitest";
import { fireEvent } from "@testing-library/dom";
import { computed, signal, type Signal } from "@takazudo/zfb/zudo-react";
import { cleanup, render, settle } from "./support/render";

afterEach(cleanup);

it("@testing-library/dom queries and events drive a zudo-react root", async () => {
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
  const view = render(Rename, { name });
  const input = view.getByLabelText("Name") as HTMLInputElement;
  const button = view.getByRole("button", { name: "Rename" }) as HTMLButtonElement;
  expect(input.value).toBe("Home");
  fireEvent.input(input, { target: { value: "  " } });
  expect(name.value).toBe("  ");
  await settle();
  expect(button.disabled).toBe(true);
  name.value = "About";
  await settle();
  expect(input.value).toBe("About");
  expect(button.disabled).toBe(false);
  view.unmount();
  expect(view.container.isConnected).toBe(false);
});
