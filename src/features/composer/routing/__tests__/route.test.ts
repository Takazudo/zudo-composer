import { describe, expect, it } from "vitest";
import { formatComposerRoute, parseComposerRoute } from "../route";
const config = { isKnownProvider: (id: string) => ["indexeddb", "files"].includes(id) };
describe("Composer query routes", () => {
  it("uses strict provider-qualified query URLs", () => {
    expect(formatComposerRoute({ kind: "index" })).toBe("/composer");
    const href = formatComposerRoute({ kind: "detail", providerId: "files", recordId: "page" });
    expect(href).toBe("/composer?provider=files&composition=page");
    expect(parseComposerRoute(new URL(href, "https://example.test"), config)).toEqual({ status: "matched", route: { kind: "detail", providerId: "files", recordId: "page" } });
  });
  it("rejects hashes, duplicates, unsafe record ids, missing identities and preview routes", () => {
    for (const href of ["/composer#/composition/files/page", "/composer?provider=files&composition=../wrong", "/composer?provider=files&composition=a&composition=b", "/composer?composition=a", "/composer?provider=other&composition=a", "/composer/preview"]) expect(parseComposerRoute(new URL(href, "https://example.test"), config).status, href).toBe("not-found");
  });
  it("opens the library or new-dialog target without a record fallback", () => {
    for (const search of ["", "?new=1"]) expect(parseComposerRoute({ pathname: "/composer", search }, config)).toEqual({ status: "matched", route: { kind: "index" } });
  });
});
