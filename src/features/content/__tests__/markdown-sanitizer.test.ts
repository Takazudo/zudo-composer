import { h } from "preact";
import { render, waitFor } from "@testing-library/preact";
import { ProseMd } from "@zudo-sg/ui";
import { describe, expect, it } from "vitest";

describe("Markdown preview sanitizer integration", () => {
  it("never returns executable HTML from HTML-looking Markdown source", async () => {
    render(
      h(ProseMd, {
        markdown: 'Safe <script>window.__markdown_xss = true;</script>\n\n<img src="x" onerror="window.__markdown_xss = true" />\n',
      }),
    );
    await waitFor(() => expect(document.querySelector("img")).toBeInTheDocument());
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("[onerror]")).toBeNull();
  }, 60_000);
});
