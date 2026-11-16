import { describe, expect, it } from "vitest";
import { composer } from "../config";

describe("host document and authority configuration", () => {
  it("preserves explicit host declarations outside browser settings", () => {
    const hostDocument = { module: "host/document", rendererId: "host", rendererVersion: "1" };
    const config = composer({ pack: "host/pack", hostDocument, authoringAuthority: "workspace" });
    expect(config.hostDocument).toEqual(hostDocument);
    expect(config.authoringAuthority).toBe("workspace");
    expect(config.settings).not.toHaveProperty("hostDocument");
    expect(config.settings).not.toHaveProperty("authoringAuthority");
  });
  it.each(["./renderer", "/renderer", "host/src/renderer", "https://example.org/renderer"])("rejects nonpublic renderer specifier %s", (module) => {
    expect(() => composer({ pack: "host/pack", hostDocument: { module, rendererId: "host", rendererVersion: "1" } })).toThrow();
  });
  it("rejects unknown authority and renderer fields", () => {
    expect(() => composer({ pack: "host/pack", authoringAuthority: "generated" } as never)).toThrow();
    expect(() => composer({ pack: "host/pack", hostDocument: { module: "host/document", rendererId: "host", rendererVersion: "1", command: "run" } } as never)).toThrow();
  });
  it.each([".", "..", "../private", "/public", "public/../private", "public\\assets"])("rejects unsafe public directory %s", (publicDir) => {
    expect(() => composer({ pack: "host/pack", hostDocument: { module: "host/document", rendererId: "host", rendererVersion: "1", publicDir } })).toThrow();
  });
});
