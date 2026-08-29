/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../test-support/cleanup";
import { describe, expect, it, vi } from "vitest";
import { render, renderHook } from "@testing-library/preact";
import {
  isEditableEventTarget,
  useComposerKeyboard,
  type ComposerKeyboardOptions,
  type KeyboardHost,
} from "../use-composer-keyboard";

interface SyntheticKey {
  key: string;
  target: unknown;
  preventDefault: () => void;
}

/** Mount the hook against a controllable host and return a way to fire keys. */
function setup(opts: Omit<ComposerKeyboardOptions, "host">) {
  let listener: ((event: KeyboardEvent) => void) | undefined;
  const host: KeyboardHost = {
    addEventListener: (_type, l) => {
      listener = l;
    },
    removeEventListener: () => {
      listener = undefined;
    },
  };
  function Probe() {
    useComposerKeyboard({ ...opts, host });
    return null;
  }
  render(<Probe />);
  const fire = (key: string, target: unknown = { tagName: "BODY", isContentEditable: false }) => {
    const event: SyntheticKey = { key, target, preventDefault: vi.fn() };
    listener?.(event as unknown as KeyboardEvent);
    return event;
  };
  return { fire };
}

describe("isEditableEventTarget", () => {
  it("flags inputs, textareas, selects, and contentEditable", () => {
    expect(isEditableEventTarget({ tagName: "INPUT", isContentEditable: false } as never)).toBe(true);
    expect(isEditableEventTarget({ tagName: "TEXTAREA", isContentEditable: false } as never)).toBe(true);
    expect(isEditableEventTarget({ tagName: "SELECT", isContentEditable: false } as never)).toBe(true);
    expect(isEditableEventTarget({ tagName: "DIV", isContentEditable: true } as never)).toBe(true);
  });
  it("does not flag ordinary elements or null", () => {
    expect(isEditableEventTarget({ tagName: "DIV", isContentEditable: false } as never)).toBe(false);
    expect(isEditableEventTarget(null)).toBe(false);
  });
});

describe("useComposerKeyboard — the guard matrix (#251)", () => {
  it("Delete removes the current selection in Edit mode", () => {
    const onRemoveSelected = vi.fn();
    const { fire } = setup({ mode: "edit", selectedId: "n1", onRemoveSelected, onEscape: vi.fn() });
    const event = fire("Delete");
    expect(onRemoveSelected).toHaveBeenCalledWith("n1");
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("Backspace also removes the current selection", () => {
    const onRemoveSelected = vi.fn();
    const { fire } = setup({ mode: "edit", selectedId: "n1", onRemoveSelected, onEscape: vi.fn() });
    fire("Backspace");
    expect(onRemoveSelected).toHaveBeenCalledWith("n1");
  });

  it("NEVER removes while focus is in an editable control", () => {
    const onRemoveSelected = vi.fn();
    const { fire } = setup({ mode: "edit", selectedId: "n1", onRemoveSelected, onEscape: vi.fn() });
    fire("Delete", { tagName: "INPUT", isContentEditable: false });
    fire("Backspace", { tagName: "TEXTAREA", isContentEditable: false });
    fire("Delete", { tagName: "DIV", isContentEditable: true });
    expect(onRemoveSelected).not.toHaveBeenCalled();
  });

  it("NEVER mutates in Preview mode", () => {
    const onRemoveSelected = vi.fn();
    const { fire } = setup({ mode: "preview", selectedId: "n1", onRemoveSelected, onEscape: vi.fn() });
    fire("Delete");
    expect(onRemoveSelected).not.toHaveBeenCalled();
  });

  it("does nothing when nothing is selected (virtual root)", () => {
    const onRemoveSelected = vi.fn();
    const { fire } = setup({ mode: "edit", selectedId: null, onRemoveSelected, onEscape: vi.fn() });
    fire("Delete");
    expect(onRemoveSelected).not.toHaveBeenCalled();
  });

  it("Escape closes menus/dialogs — even in Preview, since it never mutates", () => {
    const onEscape = vi.fn();
    const preview = setup({ mode: "preview", selectedId: "n1", onRemoveSelected: vi.fn(), onEscape });
    preview.fire("Escape");
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("Escape is still guarded against editable focus (the dialog handles its own)", () => {
    const onEscape = vi.fn();
    const { fire } = setup({ mode: "edit", selectedId: "n1", onRemoveSelected: vi.fn(), onEscape });
    fire("Escape", { tagName: "INPUT", isContentEditable: false });
    expect(onEscape).not.toHaveBeenCalled();
  });

  it("suppresses Delete/Backspace while a ComposerMenu is open (issue #256) — it owns its own Delete item", () => {
    const onRemoveSelected = vi.fn();
    const { fire } = setup({ mode: "edit", selectedId: "n1", onRemoveSelected, onEscape: vi.fn(), menuOpen: true });
    fire("Delete");
    fire("Backspace");
    expect(onRemoveSelected).not.toHaveBeenCalled();
  });

  it("still runs onEscape while a ComposerMenu is open — the menu's own listener additionally closes itself", () => {
    const onEscape = vi.fn();
    const { fire } = setup({ mode: "edit", selectedId: "n1", onRemoveSelected: vi.fn(), onEscape, menuOpen: true });
    fire("Escape");
    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});

describe("useComposerKeyboard — effect does not rebind on unrelated rerenders (#286)", () => {
  it("does not remove/re-add the keydown listener when every option is referentially stable", () => {
    const host: KeyboardHost = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const onRemoveSelected = vi.fn();
    const onEscape = vi.fn();
    const options: ComposerKeyboardOptions = {
      mode: "edit",
      selectedId: "n1",
      onRemoveSelected,
      onEscape,
      host,
    };

    const { rerender } = renderHook((opts: ComposerKeyboardOptions) => useComposerKeyboard(opts), {
      initialProps: options,
    });
    expect(host.addEventListener).toHaveBeenCalledTimes(1);
    expect(host.removeEventListener).not.toHaveBeenCalled();

    // Re-render with a NEW options object, but every field inside it is the
    // same reference/value as before (mirrors a parent rerender where
    // `onEscape`/`onRemoveSelected` are memoized) — the effect must not tear
    // down and re-add the listener.
    rerender({ mode: "edit", selectedId: "n1", onRemoveSelected, onEscape, host });

    expect(host.addEventListener).toHaveBeenCalledTimes(1);
    expect(host.removeEventListener).not.toHaveBeenCalled();
  });

  it("DOES rebind when a dep like onEscape actually changes identity", () => {
    const host: KeyboardHost = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const onRemoveSelected = vi.fn();
    const options: ComposerKeyboardOptions = {
      mode: "edit",
      selectedId: "n1",
      onRemoveSelected,
      onEscape: vi.fn(),
      host,
    };

    const { rerender } = renderHook((opts: ComposerKeyboardOptions) => useComposerKeyboard(opts), {
      initialProps: options,
    });
    expect(host.addEventListener).toHaveBeenCalledTimes(1);

    rerender({ mode: "edit", selectedId: "n1", onRemoveSelected, onEscape: vi.fn(), host });

    expect(host.removeEventListener).toHaveBeenCalledTimes(1);
    expect(host.addEventListener).toHaveBeenCalledTimes(2);
  });
});
