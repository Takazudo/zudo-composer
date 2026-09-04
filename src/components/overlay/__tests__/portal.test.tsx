import { fireEvent, render, screen } from "@testing-library/preact";
import { useState } from "preact/hooks";
import { describe, expect, it } from "vitest";
import "./overlay-test-environment";
import { OverlayPortal } from "../portal";

function Host(): preact.JSX.Element {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  return (
    <div style={{ overflow: "hidden" }}>
      <button type="button" onClick={() => setOpen((value) => !value)}>Toggle</button>
      <button type="button" onClick={() => setCount((value) => value + 1)}>Bump</button>
      {open && (
        <OverlayPortal hostClass="test-portal">
          <p>portalled {count}</p>
        </OverlayPortal>
      )}
    </div>
  );
}

describe("OverlayPortal", () => {
  it("mounts its children under document.body and keeps them updated", () => {
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    const portalled = screen.getByText(/portalled/);
    expect(portalled.closest(".test-portal")?.parentElement).toBe(document.body);
    fireEvent.click(screen.getByRole("button", { name: "Bump" }));
    expect(screen.getByText("portalled 1")).toBeInTheDocument();
  });

  it("removes its host when the portal unmounts", () => {
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    expect(document.querySelector(".test-portal")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    expect(document.querySelector(".test-portal")).toBeNull();
  });
});
