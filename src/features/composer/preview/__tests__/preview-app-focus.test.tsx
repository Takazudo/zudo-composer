import { act } from "preact/test-utils";
import { cleanup, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureComponentManifest, fixtureComponentProvider, createFixtureSampleDocument } from "../../test-support/fixture-pack";
import ComposerPreviewApp from "../preview-app";
import { renderMessage } from "../protocol";

const origin = window.location.origin;
const session = { mode: "edit" as const, theme: "light" as const, selectedId: "sample-section" };

function parentMessage(parent: object, data: unknown): Event {
  const message = new Event("message");
  Object.defineProperties(message, {
    data: { configurable: true, value: data },
    origin: { configurable: true, value: origin },
    source: { configurable: true, value: parent },
  });
  return message;
}

function snapshot(recordId: string) {
  const document = createFixtureSampleDocument();
  document.id = recordId;
  return { document, localRecordId: recordId };
}

describe("Composer preview focus preservation", () => {
  afterEach(() => cleanup());

  it("restores a focused canvas token after an accepted snapshot remounts the node", () => {
    const parent = { postMessage: vi.fn() };
    const parentWindow = vi.spyOn(window, "parent", "get").mockReturnValue(parent as never);
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const view = render(<ComposerPreviewApp provider={fixtureComponentProvider} />);

    try {
      act(() => {
        window.dispatchEvent(parentMessage(parent, renderMessage(
          { packId: fixtureComponentManifest.packId, packVersion: fixtureComponentManifest.packVersion },
          1,
          snapshot("sample"),
          session,
        )));
      });
      const firstMenu = screen.getByRole("button", { name: "Open menu for Section" });
      firstMenu.focus();
      expect(firstMenu).toHaveAttribute("data-zc-focus-token", "node-menu:sample-section");
      expect(firstMenu).toHaveFocus();

      act(() => {
        window.dispatchEvent(parentMessage(parent, renderMessage(
          { packId: fixtureComponentManifest.packId, packVersion: fixtureComponentManifest.packVersion },
          2,
          snapshot("sample-revalidated"),
          session,
        )));
      });

      const remountedMenu = screen.getByRole("button", { name: "Open menu for Section" });
      expect(remountedMenu).not.toBe(firstMenu);
      expect(remountedMenu).toHaveFocus();
      expect(hasFocus).toHaveBeenCalled();
    } finally {
      view.unmount();
      hasFocus.mockRestore();
      parentWindow.mockRestore();
    }
  });

  it("does not pull focus back from host UI after an accepted snapshot", () => {
    const parent = { postMessage: vi.fn() };
    const parentWindow = vi.spyOn(window, "parent", "get").mockReturnValue(parent as never);
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const view = render(<ComposerPreviewApp provider={fixtureComponentProvider} />);

    try {
      act(() => {
        window.dispatchEvent(parentMessage(parent, renderMessage(
          { packId: fixtureComponentManifest.packId, packVersion: fixtureComponentManifest.packVersion },
          1,
          snapshot("sample"),
          session,
        )));
      });
      screen.getByRole("button", { name: "Open menu for Section" }).focus();
      hasFocus.mockReturnValue(false);

      act(() => {
        window.dispatchEvent(parentMessage(parent, renderMessage(
          { packId: fixtureComponentManifest.packId, packVersion: fixtureComponentManifest.packVersion },
          2,
          snapshot("sample-revalidated"),
          session,
        )));
      });

      expect(screen.getByRole("button", { name: "Open menu for Section" })).not.toHaveFocus();
    } finally {
      view.unmount();
      hasFocus.mockRestore();
      parentWindow.mockRestore();
    }
  });
});
