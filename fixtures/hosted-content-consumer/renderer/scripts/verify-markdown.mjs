import assert from "node:assert/strict";
import { renderHostMarkdown } from "../src/markdown.ts";
const html = renderHostMarkdown("## 日本語の見出し\n\n**強調**と[安全な案内](https://example.com/course)");
assert(html.includes("<h2>日本語の見出し</h2>"));
assert(html.includes("<strong>強調</strong>"));
assert(html.includes('<a href="https://example.com/course">安全な案内</a>'));
for (const source of ["<script>alert(1)</script>", "[x](javascript:alert(1))", "[x](%6Aavascript:alert(1))", "![x](https://example.com/outside.svg)"])
  assert.throws(() => renderHostMarkdown(source), "Unsafe source must fail rather than generate active HTML");
assert(renderHostMarkdown("[安全な空白](https://example.com/a%20b)").includes('href="https://example.com/a%20b"'));
console.log("Real host Markdown renders headings/bold/safe links and rejects executable HTML/URLs and unapproved images.");
