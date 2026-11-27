import { Show, signal } from "@takazudo/zfb/zudo-react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, settle } from "../../../test/render";
import "./overlay-test-environment";
import { OverlayPortal } from "../portal";

function Host() {
  const open = signal(false);
  const count = signal(0);
  return (
    <div style={{ overflow: "hidden" }}>
      <button type="button" on:click={() => {
        open.value = !open.value;
      }}>Toggle</button>
      <button type="button" on:click={() => {
        count.value += 1;
      }}>Bump</button>
      <Show when={open}>
        {() => (
          <OverlayPortal hostClass="test-portal">
            <p>portalled {count}</p>
          </OverlayPortal>
        )}
      </Show>
    </div>
  );
}

describe("OverlayPortal", () => {
  it("mounts its children under document.body and keeps them updated", async () => {
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    await settle();
    const portalled = screen.getByText(/portalled/);
    expect(portalled.closest(".test-portal")?.parentElement).toBe(document.body);
    fireEvent.click(screen.getByRole("button", { name: "Bump" }));
    await settle();
    expect(screen.getByText("portalled 1")).toBeInTheDocument();
  });

  it("removes its host when the portal unmounts", async () => {
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    await settle();
    expect(document.querySelector(".test-portal")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    await settle();
    expect(document.querySelector(".test-portal")).toBeNull();
  });
});
