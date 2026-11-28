// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  HEADLESS_PROVIDER_COUPLING,
  ROOT_CONFIG_PROVIDER_COUPLING,
  ZUDO_REACT_IMPORT_SPECIFIERS,
  isRemovedHostDependency,
  isRemovedHostImport,
  isUiRuntimeSpecifier,
  moduleSpecifiers,
} from "../zudo-react-specifiers.mjs";

describe("standalone handoff zudo-react exemption", () => {
  it("allows only the exact runtime entry points as import specifiers", () => {
    expect(ZUDO_REACT_IMPORT_SPECIFIERS).toEqual([
      "@takazudo/zfb/zudo-react",
      "@takazudo/zfb/zudo-react/jsx-runtime",
      "@takazudo/zfb/zudo-react/jsx-dev-runtime",
      "@takazudo/zfb/zudo-react/client",
      "@takazudo/zfb/zudo-react/server",
    ]);
    for (const specifier of ZUDO_REACT_IMPORT_SPECIFIERS) expect(isRemovedHostImport(specifier), specifier).toBe(false);
  });

  it("rejects the bare application entry, the testing entry and every other zfb subpath in source", () => {
    for (const specifier of ["@takazudo/zfb", "@takazudo/zfb/zudo-react/testing", "@takazudo/zfb/zudo-react/hydrate", "@takazudo/zfb/config", "@takazudo/zfb/jsx-runtime", "virtual-zfb", "@takazudo/zudo-doc"]) {
      expect(isRemovedHostImport(specifier), specifier).toBe(true);
    }
  });

  it("keeps the bare package name allowed only as a manifest dependency key", () => {
    expect(isRemovedHostDependency("@takazudo/zfb")).toBe(false);
    expect(isRemovedHostDependency("@takazudo/zfb-md-wasm")).toBe(true);
    expect(isRemovedHostDependency("@takazudo/zudo-doc")).toBe(true);
  });
});

describe("headless boundary zudo-react exemption", () => {
  it("treats only the runtime entry points and the quoted package name as non-coupling text", () => {
    for (const text of ['dedupe: ["@takazudo/zfb"]', 'import("@takazudo/zfb/zudo-react").Child', '"@takazudo/zfb/zudo-react/server"']) expect(HEADLESS_PROVIDER_COUPLING.test(text), text).toBe(false);
    for (const text of ['"@takazudo/zfb/zudo-react/testing"', '"@takazudo/zfb/config"', "@takazudo/zfb/zudo-react/hydrate.js", "zfb build", '"@zudo-composer/ui"']) expect(HEADLESS_PROVIDER_COUPLING.test(text), text).toBe(true);
  });

  it("keeps the root config's md-wasm allowance without opening other subpaths", () => {
    expect(ROOT_CONFIG_PROVIDER_COUPLING.test('"@takazudo/zfb-md-wasm": "6.0.1"')).toBe(false);
    expect(ROOT_CONFIG_PROVIDER_COUPLING.test('"@takazudo/zfb": "7.2.0"')).toBe(false);
    expect(ROOT_CONFIG_PROVIDER_COUPLING.test('"@takazudo/zfb/zudo-react/testing"')).toBe(true);
  });

  it("finds every UI runtime import form, including a dynamic import of the bare entry", () => {
    const source = [
      'import { signal } from "@takazudo/zfb/zudo-react";',
      'import type { Child } from "preact";',
      'export { mount } from "@takazudo/zfb/zudo-react/client";',
      'const app = await import("@takazudo/zfb");',
      'type View = import("@takazudo/zfb/zudo-react/testing").Island;',
      'const generated = `import { h } from "@takazudo/zfb/zudo-react";`;',
    ].join("\n");
    expect(moduleSpecifiers(source, "probe.ts")).toEqual([
      "@takazudo/zfb/zudo-react",
      "preact",
      "@takazudo/zfb/zudo-react/client",
      "@takazudo/zfb",
      "@takazudo/zfb/zudo-react/testing",
    ]);
    expect(moduleSpecifiers('const generated = `${"x"}: import("@takazudo/zfb/zudo-react").Child`;', "probe.ts")).toEqual([]);
    expect(["@takazudo/zfb", "@takazudo/zfb/zudo-react", "preact/hooks"].every(isUiRuntimeSpecifier)).toBe(true);
    expect(isUiRuntimeSpecifier("@takazudo/zfb-md-wasm")).toBe(false);
  });
});
