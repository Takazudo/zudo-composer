/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import {
  SitemapperToolbar,
  describeSitemapperSaveStatus,
} from "../sitemapper-toolbar";

afterEach(cleanup);

function renderToolbar(
  saveStatus: Parameters<typeof SitemapperToolbar>[0]["saveStatus"] = { kind: "saved" },
  onRetrySave?: () => void,
) {
  render(
    <SitemapperToolbar
      documentName="Marketing sitemap"
      saveStatus={saveStatus}
      onRetrySave={onRetrySave}
    />,
  );
}

describe("SitemapperToolbar", () => {
  it("shows the document name and honest saved status", () => {
    renderToolbar();
    expect(screen.getByText("Marketing sitemap")).toBeInTheDocument();
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("Sitemap")).toBeInTheDocument();
  });

  it.each([
    [{ kind: "dirty" as const }, "Unsaved changes"],
    [{ kind: "saving" as const }, "Saving…"],
    [{ kind: "error", reason: "quota" } as const, "Save failed"],
    [{ kind: "unsaved" as const }, "Unsaved changes"],
  ])("describes %s as %s", (status, expected) => {
    expect(describeSitemapperSaveStatus(status)).toBe(expected);
  });

  it("shows Retry only for an error and invokes it", () => {
    const onRetrySave = vi.fn();
    renderToolbar({ kind: "error", reason: "quota" }, onRetrySave);
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(screen.getByText("Save failed")).toHaveAttribute("title", "quota");
    fireEvent.click(retry);
    expect(onRetrySave).toHaveBeenCalledOnce();
  });

  it("does not render a retry button for a non-error state", () => {
    renderToolbar({ kind: "dirty" });
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });
});
