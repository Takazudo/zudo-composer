/**
 * @vitest-environment jsdom
 *
 * NOT the repo-wide happy-dom environment: under happy-dom 16.8.1 DOMPurify
 * reports `isSupported: true` but sanitizes nothing (`<script>` and `onerror=`
 * survive verbatim), so an XSS suite there would assert against a sanitizer
 * that never ran. `markdown-runtime.ts` refuses such a DOM outright — see its
 * `SANITIZER_PROBE` — which is exactly why these tests need a real one.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  createMarkdownRuntime,
  renderMarkdown,
  type MarkdownModule,
} from "../markdown-runtime";

// First call pays the one-time focused render-wasm instantiation cost (~2MB).
const WASM_WARMUP_TIMEOUT_MS = 60_000;

async function render(source: string) {
  const result = await renderMarkdown(source);
  return { ...result, html: result.html ?? "" };
}

beforeAll(async () => {
  await renderMarkdown("warm up");
}, WASM_WARMUP_TIMEOUT_MS);

describe("renderMarkdown — markdown constructs", () => {
  it("renders headings, emphasis, links and lists", async () => {
    const { html, diagnostics } = await render(
      "## Title\n\n**bold** and *italic* and [link](https://example.com)\n\n- one\n- two\n",
    );
    expect(diagnostics).toEqual([]);
    // zfb's always-on HeadingLinks plugin appends the hash-link anchor; the
    // sanitizer's aria-* allowance keeps its label intact.
    expect(html).toContain('<h2>Title<a href="#title" class="hash-link"');
    expect(html).toContain('aria-label="Direct link to Title"');
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain('<a href="https://example.com">link</a>');
    expect(html).toContain("<li>");
  });

  it("renders the GFM constructs the site build enables", async () => {
    const { html, diagnostics } = await render(
      "| a | b |\n| - | - |\n| 1 | 2 |\n\n~~gone~~\n",
    );
    expect(diagnostics).toEqual([]);
    expect(html).toContain("<table>");
    expect(html).toContain("<th>a</th>");
    expect(html).toContain("<del>gone</del>");
  });

  it("renders zudo-doc 5 task lists and footnotes", async () => {
    const { html, diagnostics } = await render(
      "- [x] done\n- [ ] todo\n\nReference[^1].\n\n[^1]: Footnote body.\n",
    );
    expect(diagnostics).toEqual([]);
    expect(html).toContain('<input type="checkbox" disabled="" checked="">');
    expect(html).toContain('<input type="checkbox" disabled="">');
    expect(html).toContain('href="#user-content-fn-1"');
    expect(html).toContain('class="footnotes"');
  });

  it("renders CJK emphasis the way the site build does", async () => {
    const { html, diagnostics } = await render("これは**重要**な話です。\n");
    expect(diagnostics).toEqual([]);
    expect(html).toContain("<strong>重要</strong>");
  });

  it("allocates hierarchical heading ids like the site build", async () => {
    const { html, diagnostics } = await render(
      "## Parent\n\n### Child\n\n## Other\n\n### Child\n",
    );
    expect(diagnostics).toEqual([]);
    expect(html).toContain('id="parent-child"');
    expect(html).toContain('id="other-child"');
    expect(html).not.toContain('id="child-1"');
  });

  it("accepts a bare HTML void element with the 2.10 parser", async () => {
    const { html, diagnostics } = await renderMarkdown('<img src="x">\n');
    expect(html).toBe('<img src="x">');
    expect(diagnostics).toEqual([]);
  });
});

describe("renderMarkdown — fenced code", () => {
  it("emits semantic hi-* classes for a known language", async () => {
    const { html, diagnostics } = await render("```js\nconst answer = 42;\n```\n");
    expect(diagnostics).toEqual([]);
    expect(html).toContain('<pre class="hi-root">');
    expect(html).toContain('<span class="hi-kw">const</span>');
    expect(html).not.toContain("syntect-");
    expect(html).not.toContain("style=");
  });

  it("keeps document order when several fences are present", async () => {
    const { html } = await render("```js\nconst a = 1;\n```\n\ntext\n\n```css\na{color:red}\n```\n");
    const firstRoot = html.indexOf("hi-kw");
    const cssIndex = html.indexOf("hi-tag");
    expect(firstRoot).toBeGreaterThan(-1);
    expect(cssIndex).toBeGreaterThan(firstRoot);
  });

  it("falls back to escaped markup for an unknown language", async () => {
    const { html, diagnostics } = await render("```nosuchlang\nabc <tag> & \"q\"\n```\n");
    expect(html).toContain('<pre class="hi-root">');
    expect(html).toContain("abc &lt;tag&gt; &amp;");
    expect(html).not.toContain("<tag>");
    expect(diagnostics).toEqual([]);
  });

  it("highlights fences written with CRLF line endings", async () => {
    const { html, diagnostics } = await render("```js\r\nconst answer = 42;\r\n```\r\n");
    expect(diagnostics).toEqual([]);
    expect(html).toContain('<span class="hi-kw">const</span>');
  });

  it("leaves an info-less fence as a plain code block", async () => {
    const { html, diagnostics } = await render("```\nplain text\n```\n");
    expect(diagnostics).toEqual([]);
    expect(html).toContain("<pre><code>plain text</code></pre>");
  });

  it("preserves language-aware class highlighting for a nested fence", async () => {
    const { html, diagnostics } = await render("> ```js\n> const a = 1;\n> ```\n");
    expect(html).toContain('<pre class="hi-root">');
    expect(html).toContain('<span class="hi-kw">const</span>');
    expect(html).not.toContain("syntect-");
    expect(html).not.toContain("style=");
    expect(diagnostics).toEqual([]);
  });
});

describe("renderMarkdown — sanitization", () => {
  it("drops a raw script element", async () => {
    const { html } = await render("<script>alert(1)</script>\n\ntext\n");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(1)");
    expect(html).toContain("text");
  });

  it("drops event-handler attributes", async () => {
    const { html } = await render('<a href="#x" onclick="alert(1)">x</a>\n');
    expect(html).not.toMatch(/\son[a-z]+=/i);
    expect(html).toContain('href="#x"');
  });

  it("drops a javascript: link target", async () => {
    const { html } = await render("[click](javascript:alert(3))\n");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("click");
  });

  it("drops an svg onload payload", async () => {
    const { html } = await render('<svg onload="alert(1)" />\n');
    expect(html).not.toMatch(/\son[a-z]+=/i);
    expect(html).not.toContain("<svg");
  });

  it("drops an iframe", async () => {
    const { html } = await render('<iframe src="https://evil.example"></iframe>\n');
    expect(html).not.toContain("<iframe");
  });

  it("drops inline style attributes", async () => {
    const { html } = await render('<div style="position:fixed;inset:0">x</div>\n');
    expect(html).not.toContain("style=");
    expect(html).toContain("x");
  });

  it("drops data-* attributes so prose cannot impersonate a composer node", async () => {
    const { html } = await render(
      '<span data-zc-node-id="root" data-zc-affordance="">x</span>\n',
    );
    expect(html).not.toContain("data-zc-");
    expect(html).toContain("x");
  });

  it("allows only disabled task-list checkboxes from raw input markup", async () => {
    const { html } = await render(
      '<input type="text" value="active" /><input type="checkbox" checked />\n',
    );
    expect(html).not.toContain('type="text"');
    expect(html).toContain('<input type="checkbox" checked="" disabled="">');
  });

  it("keeps benign inline html", async () => {
    const { html } = await render('<span class="note">kept</span>\n');
    expect(html).toContain('<span class="note">kept</span>');
  });
});

describe("createMarkdownRuntime — module loading", () => {
  const stubModule: MarkdownModule = {
    renderHtml: async () => ({ html: "<p>ok</p>", frontmatter: null, diagnostics: [] }),
  };

  it("evicts a rejected import so a later call can retry", async () => {
    const importModule = vi
      .fn<() => Promise<MarkdownModule>>()
      .mockRejectedValueOnce(new Error("chunk load failed"))
      .mockResolvedValue(stubModule);
    const runtime = createMarkdownRuntime(importModule);

    const failed = await runtime.renderMarkdown("hi");
    expect(failed.html).toBeNull();
    expect(failed.diagnostics).toEqual([
      expect.objectContaining({
        severity: "error",
        source: "internal",
        message: "chunk load failed",
      }),
    ]);

    const retried = await runtime.renderMarkdown("hi");
    expect(retried.html).toBe("<p>ok</p>");
    expect(retried.diagnostics).toEqual([]);
    expect(importModule).toHaveBeenCalledTimes(2);
  });

  it("imports the module only once across successful calls", async () => {
    const importModule = vi.fn<() => Promise<MarkdownModule>>().mockResolvedValue(stubModule);
    const runtime = createMarkdownRuntime(importModule);

    await runtime.renderMarkdown("a");
    await runtime.renderMarkdown("b");

    expect(importModule).toHaveBeenCalledTimes(1);
  });

  it("returns no HTML when the renderer reports an error diagnostic", async () => {
    const runtime = createMarkdownRuntime(async () => ({
      renderHtml: async () => ({
        html: "<p>partial</p>",
        frontmatter: null,
        diagnostics: [
          {
            severity: "error" as const,
            source: "markdown" as const,
            message: "invalid markdown",
            line: 1,
            column: 1,
          },
        ],
      }),
    }));

    const { html, diagnostics } = await runtime.renderMarkdown("broken");
    expect(html).toBeNull();
    expect(diagnostics).toEqual([
      expect.objectContaining({ severity: "error", source: "markdown" }),
    ]);
  });

  it("surfaces a thrown wasm trap as an error diagnostic", async () => {
    const runtime = createMarkdownRuntime(async () => ({
      ...stubModule,
      renderHtml: async () => {
        throw new Error("wasm trap");
      },
    }));

    const { html, diagnostics } = await runtime.renderMarkdown("hi");
    expect(html).toBeNull();
    expect(diagnostics).toEqual([
      expect.objectContaining({ severity: "error", source: "internal", message: "wasm trap" }),
    ]);
  });
});
