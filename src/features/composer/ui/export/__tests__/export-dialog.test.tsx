/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../../test-support/cleanup";
import { useState } from "preact/hooks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import { generateJsx, type BrowserJsxExportOutcome } from "../../../../../composer/browser";
import { TEST_COMPONENT_IDS, makeDocument, makeNode, resetTestIds, testManifest } from "../../test-support/composer-fixtures";
import { ComposerExportDialog } from "../export-dialog";

beforeEach(() => {
  resetTestIds();
});

describe("ComposerExportDialog — content states", () => {
  it("shows a generating note while result is null", () => {
    render(
      <ComposerExportDialog open documentName="Doc" result={null} onClose={vi.fn()} />,
    );
    expect(screen.getByText(/generating/i)).toBeInTheDocument();
  });

  it("renders the generator's code byte-for-byte, plus a component/line summary", () => {
    const doc = makeDocument([makeNode(TEST_COMPONENT_IDS.label, { text: "Hi" })], "My doc");
    const result = generateJsx(doc, testManifest);
    render(<ComposerExportDialog open documentName="My doc" result={result} onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: /export — my doc/i })).toBeInTheDocument();
    const code = screen.getByText((_, node) => node?.tagName === "CODE" && node.textContent === result.code);
    expect(code).toBeInTheDocument();
    expect(screen.getByText(/1 component/)).toBeInTheDocument();
  });

  it("shows blocked-export diagnostics for an opaque node instead of code", () => {
    const doc = makeDocument([makeNode("unknown.thing", {}, {}, "ghost")]);
    const result = generateJsx(doc, testManifest);
    expect(result.blocked).toBe(true);
    render(<ComposerExportDialog open documentName="Doc" result={result} onClose={vi.fn()} />);

    expect(screen.getByText(/export is blocked/i)).toBeInTheDocument();
    expect(screen.getByText(/unknown component/i)).toBeInTheDocument();
    expect(screen.queryByText(/^const /)).not.toBeInTheDocument();
  });

  it("renders nothing (no dialog content) while closed", () => {
    const doc = makeDocument([makeNode(TEST_COMPONENT_IDS.label, { text: "Hi" })]);
    const result = generateJsx(doc, testManifest);
    render(<ComposerExportDialog open={false} documentName="Doc" result={result} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("labels a resolved linked Copy result as a standalone snapshot", () => {
    const doc = makeDocument([makeNode(TEST_COMPONENT_IDS.label, { text: "Hi" })]);
    const generation = generateJsx(doc, testManifest);
    const copyOutcome: BrowserJsxExportOutcome = {
      status: "ready",
      kind: "resolved-standalone-snapshot",
      generation,
      message: "Resolved standalone snapshot — future Global-template changes will not propagate to this copied code.",
    };
    render(<ComposerExportDialog open documentName="Doc" result={generation} copyOutcome={copyOutcome} onClose={vi.fn()} />);

    expect(screen.getByText(/future Global-template changes will not propagate/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy resolved standalone snapshot/i })).toBeInTheDocument();
  });

  it("blocks Copy on an unresolved linked dependency instead of rendering local-only code", () => {
    const doc = makeDocument([makeNode(TEST_COMPONENT_IDS.label, { text: "Hi" })]);
    const generation = generateJsx(doc, testManifest);
    const copyOutcome: BrowserJsxExportOutcome = {
      status: "blocked",
      diagnostic: {
        kind: "dependency",
        code: "missing-resolution",
        message: "The linked Global template is still resolving, so Copy JSX is unavailable.",
      },
    };
    render(<ComposerExportDialog open documentName="Doc" result={generation} copyOutcome={copyOutcome} onClose={vi.fn()} />);

    expect(screen.getByText(/copy jsx is blocked/i)).toBeInTheDocument();
    expect(screen.getByText(/still resolving/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copy jsx/i })).not.toBeInTheDocument();
  });
});

/** Realistic host: an "Open export" trigger button that owns `open` state,
 * exactly like #251's integration is expected to wire this dialog up. */
function DialogHost() {
  const [open, setOpen] = useState(false);
  const doc = makeDocument([
    makeNode(TEST_COMPONENT_IDS.label, { text: "Hi" }, {}, "a"),
    makeNode(TEST_COMPONENT_IDS.label, { text: "Bye" }, {}, "b"),
  ]);
  const result = generateJsx(doc, testManifest);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open export
      </button>
      <ComposerExportDialog open={open} documentName="Doc" result={result} onClose={() => setOpen(false)} />
    </div>
  );
}

describe("ComposerExportDialog — focus lifecycle", () => {
  it("moves initial focus into the dialog when it opens", () => {
    render(<DialogHost />);
    fireEvent.click(screen.getByRole("button", { name: "Open export" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("restores focus to the trigger element after Escape closes the dialog", () => {
    render(<DialogHost />);
    const trigger = screen.getByRole("button", { name: "Open export" });
    // Focus the trigger explicitly (as a real keyboard user would before
    // activating it) rather than relying on a test environment's synthetic
    // click to move focus — that's a DOM-emulator behavior, not this
    // component's contract.
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("restores focus to the trigger element after the Close button closes it", () => {
    render(<DialogHost />);
    const trigger = screen.getByRole("button", { name: "Open export" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("contains Tab focus within the dialog — Tab from the last focusable wraps to the first", () => {
    render(<DialogHost />);
    fireEvent.click(screen.getByRole("button", { name: "Open export" }));

    const dialog = screen.getByRole("dialog");
    const focusables = dialog.querySelectorAll<HTMLElement>("button");
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;

    last.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  it("contains Shift+Tab focus within the dialog — from the first focusable wraps to the last", () => {
    render(<DialogHost />);
    fireEvent.click(screen.getByRole("button", { name: "Open export" }));

    const dialog = screen.getByRole("dialog");
    const focusables = dialog.querySelectorAll<HTMLElement>("button");
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;

    first.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
