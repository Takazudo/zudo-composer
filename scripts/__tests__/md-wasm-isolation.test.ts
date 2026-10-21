import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("app and documentation markdown runtimes", () => {
  it("keeps parser ownership in the pack and uses only the focused render import", () => {
    const manifest = (path: string) => JSON.parse(readFileSync(path, "utf8"));
    const tool = manifest("package.json");
    const pack = manifest("packages/ui/package.json");
    const doc = manifest("doc/package.json");
    expect(pack.dependencies["@takazudo/zfb-md-wasm"]).toBe("4.6.0");
    expect(doc.dependencies["@takazudo/zfb-md-wasm"]).toBe("4.6.0");
    for (const dependencies of [tool.dependencies, tool.peerDependencies]) {
      expect(dependencies ?? {}).not.toHaveProperty("@takazudo/zfb-md-wasm");
    }
    const runtime = readFileSync("packages/ui/src/content/prose-md/markdown-runtime.ts", "utf8");
    const parserImports = [...runtime.matchAll(/["'](@takazudo\/zfb-md-wasm(?:\/[^"']*)?)["']/g)]
      .map((match) => match[1]);
    expect(parserImports.length).toBeGreaterThan(0);
    expect(new Set(parserImports)).toEqual(new Set(["@takazudo/zfb-md-wasm/render"]));
    // Built bytes and excluded compiler/parse/highlight assets are separately
    // proved against shipped-artifacts.json by check-dist-artifact.mjs.
  });

  it("renders supported prose and recovers from diagnostics through both owners", () => {
    const output = execFileSync(process.execPath, ["--input-type=module", "--eval", `
      import assert from "node:assert/strict";
      import { createRequire } from "node:module";
      import { pathToFileURL } from "node:url";
      import { resolve } from "node:path";
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
      const cases = [
        {
          source: "## Parent\\n\\n### Child\\n\\n## Other\\n\\n### Child\\n",
          fragments: ['id="parent-child"', 'href="#parent-child"', 'id="other-child"'],
        },
        {
          source: "これは**重要**な話です。\\n\\n~~gone~~ and [link](https://example.com)",
          fragments: ['これは<strong>重要</strong>な話です。', '<del>gone</del>', '<a href="https://example.com">link</a>'],
        },
        {
          source: "| a | b |\\n| - | - |\\n| 1 | 2 |\\n\\n- [x] done\\n- [ ] todo\\n\\nReference[^1].\\n\\n[^1]: Footnote body.\\n",
          fragments: ['<thead><tr><th>a</th><th>b</th>', '<tbody><tr><td>1</td><td>2</td>',
            '<input type="checkbox" disabled="" checked=""/> done', '<input type="checkbox" disabled=""/> todo',
            'href="#user-content-fn-1"', 'id="user-content-fn-1"', 'Footnote body.', 'data-footnote-backref'],
        },
        {
          source: "\`\`\`ts\\nconst answer = 42;\\n\`\`\`\\n\\n> \`\`\`js\\n> const nested = true;\\n> \`\`\`\\n",
          fragments: ['<pre class="hi-root">', '<span class="hi-kw">const</span>',
            '<span class="hi-num">42</span>', '<blockquote><pre class="hi-root">', '<span class="hi-const">true</span>'],
        },
        {
          // Raw HTML is deliberately preserved by the parser. The UI runtime's
          // DOMPurify and prose-md-sanitize suites own the sanitizer contract.
          source: '<script>alert(1)</script>\\n\\n<img src="x" onerror="alert(2)">',
          fragments: ['<script>alert(1)</script>', '<img src="x" onerror="alert(2)">'],
        },
      ];
      // Both owners may resolve the very same pnpm module. Equality between two
      // imports would then be a tautology, so each is checked against behavior.
      for (const owner of ["packages/ui/package.json", "doc/package.json"]) {
        const require = createRequire(resolve(owner));
        const entry = require.resolve("@takazudo/zfb-md-wasm/render");
        const parser = await import(pathToFileURL(entry).href);
        const shipped = require("@takazudo/zfb-md-wasm/shipped-artifacts.json");
        assert.equal(shipped.version, "4.6.0", owner);
        for (const { source, fragments } of cases) {
          const actual = await parser.renderHtml(source, options);
          assert.deepEqual(actual.diagnostics, [], owner);
          assert.equal(typeof actual.html, "string", owner);
          for (const fragment of fragments) assert.ok(actual.html.includes(fragment), owner + ": missing " + fragment);
        }
        const broken = "---\\na: [\\n---\\n# Broken";
        const error = await parser.renderHtml(broken, options);
        assert.equal(error.html, null, owner);
        assert.ok(error.diagnostics.some(d => d.severity === "error" && d.source === "frontmatter"), owner);
        const recovered = await parser.renderHtml("# Recovered", options);
        assert.deepEqual(recovered.diagnostics, [], owner);
        assert.equal(recovered.html, "<h1>Recovered</h1>", owner);
      }
      console.log("owned focused parsers: prose and recovery passed");
    `], { encoding: "utf8" });
    expect(output).toContain("owned focused parsers: prose and recovery passed");
  });
});
