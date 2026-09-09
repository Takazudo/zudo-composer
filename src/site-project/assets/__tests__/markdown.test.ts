import { describe, expect, it } from "vitest";
import { markdownAssetDestinations, rewriteMarkdownDestinations } from "../markdown";
describe("AST Markdown assets destinations", () => {
  it("rewrites only link/image destinations, preserving prose, code, titles and external URLs", () => {
    const input = 'Text /uploaded-assets/asset-a\n\n`[code](/uploaded-assets/asset-a)`\n\n![image](/uploaded-assets/asset-a "keep title")\n\n[external](https://other.test/uploaded-assets/asset-a)';
    const output = rewriteMarkdownDestinations(input, ({ value }) => value === "/uploaded-assets/asset-a" ? "/uploaded-assets/sha256-pinned.png" : undefined);
    expect(output).toBe(input.replace('![image](/uploaded-assets/asset-a', '![image](/uploaded-assets/sha256-pinned.png'));
    expect(markdownAssetDestinations(input)).toHaveLength(2);
  });
  it("resolves reference links and escaped destinations while preserving unused definitions", () => {
    const input = '[ref]\n\n![ref][]\n\n[ref]: </uploaded-assets/asset-a> "title"\n\n[unused]: /uploaded-assets/asset-b\n\n[x](/uploaded-assets/asset-foo\\-bar)';
    const refs = markdownAssetDestinations(input); expect(refs.map(({ value }) => value)).toEqual(["/uploaded-assets/asset-a", "/uploaded-assets/asset-a", "/uploaded-assets/asset-foo-bar"]);
    const output = rewriteMarkdownDestinations(input, ({ value }) => value === "/uploaded-assets/asset-a" ? "/pinned.png" : undefined);
    expect(output).toContain('[ref]: </pinned.png> "title"'); expect(output).toContain("[unused]: /uploaded-assets/asset-b");
  });
});
