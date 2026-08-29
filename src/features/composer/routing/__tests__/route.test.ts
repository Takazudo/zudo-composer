import { describe, expect, it } from "vitest";
import { COMPOSER_DOCUMENT_PATH, formatComposerRoute, parseComposerRoute } from "../route";

const config = { isKnownProvider: (id: string) => id === "indexeddb" };

describe("standalone Composer route", () => {
  it("uses one exact document pathname and canonical hash URLs", () => {
    expect(COMPOSER_DOCUMENT_PATH).toBe("/composer");
    expect(formatComposerRoute({ kind: "index" })).toBe("/composer#/");
    expect(formatComposerRoute({ kind: "detail", providerId: "indexeddb", recordId: "hello world" }))
      .toBe("/composer#/composition/indexeddb/hello%20world");
  });

  it.each(["/composer/", "/team/composer", "/"])("rejects noncanonical pathname %s", (pathname) => {
    expect(parseComposerRoute({ pathname, hash: "#/" }, config)).toMatchObject({
      status: "not-found",
      error: { code: "wrong-document-path" },
    });
  });
});
