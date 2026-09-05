import { describe, expect, it } from "vitest";
import { markdownMediaDestinations, rewriteMarkdownDestinations } from "../markdown";
describe("AST Markdown media destinations", () => {
  it("rewrites only link/image destinations, preserving prose, code, titles and external URLs", () => {
    const input = 'Text /uploaded-media/asset-a\n\n`[code](/uploaded-media/asset-a)`\n\n![image](/uploaded-media/asset-a "keep title")\n\n[external](https://other.test/uploaded-media/asset-a)';
    const output = rewriteMarkdownDestinations(input, ({ value }) => value === "/uploaded-media/asset-a" ? "/uploaded-media/sha256-pinned.png" : undefined);
    expect(output).toBe(input.replace('![image](/uploaded-media/asset-a', '![image](/uploaded-media/sha256-pinned.png'));
    expect(markdownMediaDestinations(input)).toHaveLength(2);
  });
  it("resolves reference links and escaped destinations while preserving unused definitions", () => {
    const input = '[ref]\n\n![ref][]\n\n[ref]: </uploaded-media/asset-a> "title"\n\n[unused]: /uploaded-media/asset-b\n\n[x](/uploaded-media/asset-foo\\-bar)';
    const refs = markdownMediaDestinations(input); expect(refs.map(({ value }) => value)).toEqual(["/uploaded-media/asset-a", "/uploaded-media/asset-a", "/uploaded-media/asset-foo-bar"]);
    const output = rewriteMarkdownDestinations(input, ({ value }) => value === "/uploaded-media/asset-a" ? "/pinned.png" : undefined);
    expect(output).toContain('[ref]: </pinned.png> "title"'); expect(output).toContain("[unused]: /uploaded-media/asset-b");
  });
});
