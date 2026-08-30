/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../test-support/cleanup";
import { describe, expect, it, vi } from "vitest";
import { render, renderHook } from "@testing-library/preact";
import {
  isEditableEventTarget,
  matchesUndoRedoShortcut,
  useComposerKeyboard,
  type ComposerKeyboardOptions,
  type KeyboardHost,
} from "../use-composer-keyboard";

interface SyntheticKey {
  key: string;
  target: unknown;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  preventDefault: () => void;
}

interface ShortcutModifiers {
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
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
  const fire = (
    key: string,
    target: unknown = { tagName: "BODY", isContentEditable: false },
    modifiers: ShortcutModifiers = {},
  ) => {
    const event: SyntheticKey = {
      key,
      target,
      altKey: modifiers.altKey ?? false,
      ctrlKey: modifiers.ctrlKey ?? false,
      metaKey: modifiers.metaKey ?? false,
      shiftKey: modifiers.shiftKey ?? false,
      preventDefault: vi.fn(),
    };
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

describe("matchesUndoRedoShortcut", () => {
  const cases: Array<[string, string, ShortcutModifiers, "undo" | "redo" | null]> = [
    ["Cmd+Z", "z", { metaKey: true }, "undo"],
    ["Ctrl+Z", "z", { ctrlKey: true }, "undo"],
    ["Cmd+Shift+Z", "z", { metaKey: true, shiftKey: true }, "redo"],
    ["Ctrl+Shift+Z", "z", { ctrlKey: true, shiftKey: true }, "redo"],
    ["Ctrl+Y", "y", { ctrlKey: true }, "redo"],
    ["plain Z", "z", {}, null],
    ["Alt+Z", "z", { altKey: true }, null],
    ["Cmd+Shift+Y", "y", { metaKey: true, shiftKey: true }, null],
    ["Cmd+Y", "y", { metaKey: true }, null],
    ["Ctrl+Shift+Y", "y", { ctrlKey: true, shiftKey: true }, null],
    ["Ctrl+Alt+Z", "z", { ctrlKey: true, altKey: true }, null],
  ];

  it.each(cases)("matches %s", (_label, key, modifiers, expected) => {
    const event = {
      key,
      altKey: modifiers.altKey ?? false,
      ctrlKey: modifiers.ctrlKey ?? false,
      metaKey: modifiers.metaKey ?? false,
      shiftKey: modifiers.shiftKey ?? false,
    };
    expect(matchesUndoRedoShortcut(event as KeyboardEvent)).toBe(expected);
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

  it("fires undo and redo in Edit mode and prevents the browser default", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const { fire } = setup({
      mode: "edit",
      selectedId: null,
      onRemoveSelected: vi.fn(),
      onEscape: vi.fn(),
      onUndo,
      onRedo,
      canUndo: true,
      canRedo: true,
    });

    const undo = fire("z", undefined, { metaKey: true });
    const redo = fire("z", undefined, { ctrlKey: true, shiftKey: true });
    fire("y", undefined, { ctrlKey: true });

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(2);
    expect(undo.preventDefault).toHaveBeenCalledTimes(1);
    expect(redo.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("does not hijack undo/redo while focus is in an editable control", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const { fire } = setup({
      mode: "edit",
      selectedId: null,
      onRemoveSelected: vi.fn(),
      onEscape: vi.fn(),
      onUndo,
      onRedo,
      canUndo: true,
      canRedo: true,
    });

    const inputUndo = fire("z", { tagName: "INPUT", isContentEditable: false }, { ctrlKey: true });
    const editorRedo = fire("z", { tagName: "DIV", isContentEditable: true }, { metaKey: true, shiftKey: true });

    expect(onUndo).not.toHaveBeenCalled();
    expect(onRedo).not.toHaveBeenCalled();
    expect(inputUndo.preventDefault).not.toHaveBeenCalled();
    expect(editorRedo.preventDefault).not.toHaveBeenCalled();
  });

  it("does nothing for undo/redo in Preview mode", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const { fire } = setup({
      mode: "preview",
      selectedId: null,
      onRemoveSelected: vi.fn(),
      onEscape: vi.fn(),
      onUndo,
      onRedo,
      canUndo: true,
      canRedo: true,
    });

    const undo = fire("z", undefined, { ctrlKey: true });
    const redo = fire("y", undefined, { ctrlKey: true });

    expect(onUndo).not.toHaveBeenCalled();
    expect(onRedo).not.toHaveBeenCalled();
    expect(undo.preventDefault).not.toHaveBeenCalled();
    expect(redo.preventDefault).not.toHaveBeenCalled();
  });

  it("does not let menuOpen suppress undo/redo because history has no node subject", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const { fire } = setup({
      mode: "edit",
      selectedId: "n1",
      onRemoveSelected: vi.fn(),
      onEscape: vi.fn(),
      onUndo,
      onRedo,
      canUndo: true,
      canRedo: true,
      menuOpen: true,
    });

    fire("z", undefined, { metaKey: true });
    fire("z", undefined, { metaKey: true, shiftKey: true });

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(1);
  });

  it("does not fire or preventDefault when the matching history capability is unavailable", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const { fire } = setup({
      mode: "edit",
      selectedId: null,
      onRemoveSelected: vi.fn(),
      onEscape: vi.fn(),
      onUndo,
      onRedo,
      canUndo: false,
      canRedo: false,
    });

    const undo = fire("z", undefined, { ctrlKey: true });
    const redo = fire("y", undefined, { ctrlKey: true });

    expect(onUndo).not.toHaveBeenCalled();
    expect(onRedo).not.toHaveBeenCalled();
    expect(undo.preventDefault).not.toHaveBeenCalled();
    expect(redo.preventDefault).not.toHaveBeenCalled();
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
