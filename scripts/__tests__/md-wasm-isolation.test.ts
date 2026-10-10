import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("app and documentation markdown runtimes", () => {
  it("keeps independent parsers with matching prose output and diagnostic recovery", () => {
    const output = execFileSync(process.execPath, ["--input-type=module", "--eval", `
      import assert from "node:assert/strict";
      import { createRequire } from "node:module";
      import { pathToFileURL } from "node:url";
      import { resolve } from "node:path";
      const app = createRequire(resolve("packages/ui/package.json"));
      const doc = createRequire(resolve("doc/package.json"));
      const appEntry = app.resolve("@takazudo/zfb-md-wasm/render");
      const docEntry = doc.resolve("@takazudo/zfb-md-wasm/render");
      assert.notEqual(appEntry, docEntry);
      const current = await import(pathToFileURL(appEntry).href);
      const retained = await import(pathToFileURL(docEntry).href);
      const options = {
        filename: "prose.md",
        pipeline: {
          gfm: { strikethrough: true, table: true, autolinkLiteral: false,
            taskListItem: true, footnoteDefinition: true },
          cjkFriendly: true,
          codeHighlight: { mode: "class" },
          features: { headingIds: { strategy: "hierarchical" } },
        },
      };
      const sources = [
        "## Parent\\n\\n### Child\\n\\n## Other\\n\\n### Child\\n",
        "これは**重要**な話です。\\n\\n~~gone~~ and [link](https://example.com)",
        "| a | b |\\n| - | - |\\n| 1 | 2 |\\n\\n- [x] done\\n- [ ] todo\\n\\nReference[^1].\\n\\n[^1]: Footnote body.\\n",
        "\`\`\`ts\\nconst answer = 42;\\n\`\`\`\\n\\n> \`\`\`js\\n> const nested = true;\\n> \`\`\`\\n",
        '<script>alert(1)</script>\\n\\n<img src="x" onerror="alert(2)">',
      ];
      for (const source of sources) {
        const actual = await current.renderHtml(source, options);
        assert.deepEqual(actual, await retained.renderHtml(source, options));
        assert.equal(actual.diagnostics.length, 0);
        assert.equal(typeof actual.html, "string");
      }
      const broken = "---\\na: [\\n---\\n# Broken";
      const error = await current.renderHtml(broken, options);
      assert.equal(error.html, null);
      assert.ok(error.diagnostics.some(d => d.severity === "error" && d.source === "frontmatter"));
      assert.deepEqual(error, await retained.renderHtml(broken, options));
      const recovered = await current.renderHtml("# Recovered", options);
      assert.deepEqual(recovered.diagnostics, []);
      assert.ok(recovered.html.includes("Recovered"));
      console.log("independent parser output and recovery passed");
    `], { encoding: "utf8" });
    expect(output).toContain("independent parser output and recovery passed");
  });
});
