import { render, screen, waitFor } from "@testing-library/preact";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProseMd } from "@zudo-sg/ui";

type MarkdownRenderResult = {
  html: string | null;
  diagnostics: { severity: "error"; source: "sanitize"; message: string; line: null; column: null }[];
};

const { renderMarkdownMock } = vi.hoisted(() => ({ renderMarkdownMock: vi.fn() }));
vi.mock("@zudo-sg/ui/src/content/prose-md/markdown-runtime", () => ({ renderMarkdown: renderMarkdownMock }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => renderMarkdownMock.mockReset());

describe("the existing sanitized Markdown preview contract", () => {
  it("drops stale async output after a newer source renders", async () => {
    const oldResult = deferred<MarkdownRenderResult>();
    const currentResult = deferred<MarkdownRenderResult>();
    renderMarkdownMock.mockReturnValueOnce(oldResult.promise).mockReturnValueOnce(currentResult.promise);
    const rendered = render(<ProseMd markdown="old" />);
    rendered.rerender(<ProseMd markdown="current" />);

    currentResult.resolve({ html: "<p>current result</p>", diagnostics: [] });
    await screen.findByText("current result");
    oldResult.resolve({ html: "<p>stale result</p>", diagnostics: [] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText("stale result")).not.toBeInTheDocument();
  });

  it("shows a non-destructive diagnostic fallback when rendering fails", async () => {
    renderMarkdownMock.mockResolvedValue({
      html: null,
      diagnostics: [{ severity: "error", source: "sanitize", message: "unsafe output rejected", line: null, column: null }],
    });
    render(<ProseMd markdown={'<img src="x" onerror="bad()" />'} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("unsafe output rejected"));
    expect(document.querySelector("[onerror]")).toBeNull();
  });
});
