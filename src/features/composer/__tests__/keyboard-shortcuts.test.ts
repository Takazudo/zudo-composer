import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isEditableEventTarget, matchesUndoRedoShortcut } from "../keyboard-shortcuts";

interface ShortcutModifiers {
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
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

describe("preview-safe module boundary", () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

  it("keeps the detectors free of imports so the preview graph stays host-free", () => {
    const source = read("src/features/composer/keyboard-shortcuts.ts");
    expect(source).not.toMatch(/(?:^|\n)\s*import\s/);
    expect(source).not.toContain("preact");
  });

  it("routes the preview app and the host hook at the shared detectors", () => {
    expect(read("src/features/composer/preview/preview-app.ts")).toContain('from "../keyboard-shortcuts"');
    expect(read("src/features/composer/app/use-composer-keyboard.ts")).toContain('from "../keyboard-shortcuts"');
    expect(read("src/features/composer/preview/preview-app.ts")).not.toContain("app/use-composer-keyboard");
  });
});
