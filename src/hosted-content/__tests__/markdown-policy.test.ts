import { describe, expect, it } from "vitest";
import { DEFAULT_MARKDOWN_CONTENT_POLICY, diagnoseMarkdownValue } from "../markdown-policy";

const codes = (value: string, policy = DEFAULT_MARKDOWN_CONTENT_POLICY) => diagnoseMarkdownValue(value, policy).map(({ code }) => code);

describe("diagnoseMarkdownValue", () => {
  it("accepts prose, relative links, fragments and allowlisted protocols", () => {
    expect(codes("# Title\n\nSome *prose* with [a link](https://example.com), [local](/about#faq), [frag](#top), <mailto:hi@example.com>, <tel:+123> and `a < b` code.")).toEqual([]);
    expect(codes("[ref]: https://example.com/page\nSee [ref].")).toEqual([]);
    expect(codes("1 < 2 and 3 > 2")).toEqual([]);
  });

  it("rejects raw HTML, comments and processing instructions", () => {
    expect(codes("<b>bold</b>")).toEqual(["html-not-allowed", "html-not-allowed"]);
    expect(codes("<script src=x></script>")).toContain("html-not-allowed");
    expect(codes("<!-- hidden -->")).toEqual(["html-not-allowed"]);
    expect(codes("<img src=x onerror=alert(1)>")).toEqual(["html-not-allowed"]);
    expect(codes("<?php echo 1 ?>")).toEqual(["html-not-allowed"]);
  });

  it("rejects links with disallowed or obfuscated protocols", () => {
    expect(codes("[x](javascript:alert(1))")).toEqual(["unsafe-link"]);
    expect(codes("[x](JAVASCRIPT:alert(1))")).toEqual(["unsafe-link"]);
    expect(codes("[x](java\u0000script:alert(1))")).toEqual(["unsafe-link"]);
    expect(codes("[x](data:text/html;base64,AAAA)")).toEqual(["unsafe-link"]);
    expect(codes("[x](//evil.example/path)")).toEqual(["unsafe-link"]);
    expect(new Set(codes("[x](<vbscript:msgbox>)"))).toEqual(new Set(["unsafe-link"]));
    expect(codes("<ftp://files.example>")).toEqual(["unsafe-link"]);
    expect(codes("[ref]: javascript:alert(1)\n[ref]")).toEqual(["unsafe-link"]);
  });

  it("rejects images unless the policy allows them, and then still checks their URL", () => {
    expect(codes("![alt](https://example.com/a.png)")).toEqual(["image-not-allowed"]);
    const images = { ...DEFAULT_MARKDOWN_CONTENT_POLICY, allowImages: true };
    expect(codes("![alt](https://example.com/a.png)", images)).toEqual([]);
    expect(codes("![alt](javascript:alert(1))", images)).toEqual(["unsafe-link"]);
  });

  it("enforces the length ceiling and reports offsets in document order", () => {
    const policy = { ...DEFAULT_MARKDOWN_CONTENT_POLICY, maxLength: 10 };
    expect(diagnoseMarkdownValue("x".repeat(11), policy)).toEqual([{ code: "too-long", message: "Markdown exceeds 10 characters.", offset: 10 }]);
    const ordered = diagnoseMarkdownValue("[a](javascript:x) then <b>");
    expect(ordered.map(({ code, offset }) => [code, offset])).toEqual([["unsafe-link", 0], ["html-not-allowed", 23]]);
  });

  it("cannot be configured to allow raw HTML", () => {
    const policy: typeof DEFAULT_MARKDOWN_CONTENT_POLICY = { ...DEFAULT_MARKDOWN_CONTENT_POLICY, allowHtml: false };
    expect(codes("<div>", policy)).toEqual(["html-not-allowed"]);
    // @ts-expect-error raw HTML is never a policy option for this role
    const widened: typeof DEFAULT_MARKDOWN_CONTENT_POLICY = { ...DEFAULT_MARKDOWN_CONTENT_POLICY, allowHtml: true };
    void widened;
  });
});
