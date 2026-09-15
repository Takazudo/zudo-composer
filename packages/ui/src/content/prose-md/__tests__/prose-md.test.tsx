/**
 * Component-level tests, with `../markdown-runtime` mocked so these run fast
 * and deterministic under this repo's default happy-dom environment — no
 * wasm instantiation, no real DOMPurify. The REAL runtime (fence
 * highlighting + sanitization) is exercised end-to-end in
 * `prose-md-sanitize.test.tsx` (which needs `@vitest-environment jsdom`; see
 * that file's header).
 */
import { render, screen, waitFor } from "@testing-library/preact";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProseMd } from "../prose-md";
import { renderMarkdown } from "../markdown-runtime";
import type { MarkdownRenderResult } from "../markdown-runtime";

vi.mock("../markdown-runtime", () => ({
  renderMarkdown: vi.fn(),
}));

const mockedRenderMarkdown = vi.mocked(renderMarkdown);

/** A promise plus its resolver, so a test can control exactly when it settles. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mockedRenderMarkdown.mockReset();
});

describe("ProseMd", () => {
  it("shows the raw markdown as a quiet placeholder before the runtime resolves", () => {
    mockedRenderMarkdown.mockReturnValue(new Promise<MarkdownRenderResult>(() => {}));
    render(<ProseMd markdown="## Hi" />);
    const raw = screen.getByText("## Hi");
    expect(raw.tagName).toBe("PRE");
    expect(raw.closest(".zc-prose-md--pending")).toBeTruthy();
  });

  it("mounts the runtime's HTML once it resolves", async () => {
    mockedRenderMarkdown.mockResolvedValue({ html: "<h2>Hi</h2>", diagnostics: [] });
    render(<ProseMd markdown="## Hi" />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Hi" })).toBeInTheDocument();
    });
  });

  it("shows a compact diagnostics message when the runtime returns html: null", async () => {
    mockedRenderMarkdown.mockResolvedValue({
      html: null,
      diagnostics: [
        { severity: "error", source: "internal", message: "boom", line: null, column: null },
      ],
    });
    render(<ProseMd markdown="bad" />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("boom");
    });
  });

  it("drops a stale result superseded by a newer markdown prop", async () => {
    const first = deferred<MarkdownRenderResult>();
    const second = deferred<MarkdownRenderResult>();
    mockedRenderMarkdown.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const { rerender } = render(<ProseMd markdown="first" />);
    rerender(<ProseMd markdown="second" />);

    // The SECOND (current) request settles first…
    second.resolve({ html: "<p>second</p>", diagnostics: [] });
    await waitFor(() => {
      expect(screen.getByText("second")).toBeInTheDocument();
    });

    // …and the FIRST (stale) request settling afterward must not overwrite it.
    first.resolve({ html: "<p>first</p>", diagnostics: [] });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("first")).not.toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
  });

  it("drops a result that resolves after unmount", async () => {
    const pending = deferred<MarkdownRenderResult>();
    mockedRenderMarkdown.mockReturnValue(pending.promise);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { unmount } = render(<ProseMd markdown="x" />);
    unmount();
    pending.resolve({ html: "<p>late</p>", diagnostics: [] });
    await new Promise((r) => setTimeout(r, 0));

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
