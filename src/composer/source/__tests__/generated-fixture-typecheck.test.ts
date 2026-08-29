// Proves the JSX generator emits code that PARSES and TYPECHECKS as real
// Preact JSX with its emitted imports — including the required multiline +
// quote-bearing string prop (the bug class the escaping contract prevents).
//
// The generated module and a set of stub component modules (derived from the
// fixture manifest) are typechecked in-memory via the TypeScript compiler API:
// virtual files for the generated code + stubs, real on-disk resolution for
// `preact` / `preact/jsx-runtime`. Zero pre-emit diagnostics == the generated
// JSX is well-formed Preact JSX whose imports resolve and whose props match the
// component signatures.

import { describe, expect, it } from "vitest";
import ts from "typescript";
import { generateJsx } from "../generate-jsx";
import type { ComponentDefinition } from "../../model/types";
import { COMPOSITION_SCHEMA_VERSION } from "../../model/types";
import { COMPONENT_IDS as C, SLOT_IDS as S } from "../../__tests__/fixtures";
import { FIXTURE_COMPONENT_IDS as X, fixtureEntries, fixtureManifest as M, node } from "../../__tests__/fixtures";

const BASE = process.cwd();
const VDIR = `${BASE}/__composer_virtual__`;

function sanitize(spec: string): string {
  return spec.replace(/[^a-z0-9]+/gi, "_");
}

/** A stub component module for one manifest entry, typed from its fields/slots. */
function stubFor(entry: ComponentDefinition): string {
  const props = new Map<string, string>();
  for (const f of entry.fields) {
    if (f.prop === "children") props.set("children", "ComponentChildren");
    else props.set(f.prop, f.kind === "number" ? "number" : f.kind === "boolean" ? "boolean" : "string");
  }
  for (const slot of entry.slots) {
    if (slot.prop === "children") props.set("children", "ComponentChildren");
    else props.set(slot.prop, "ComponentChildren");
  }
  const propLines = [...props.entries()].map(([k, t]) => `${k}?: ${t};`).join(" ");
  const exportName = entry.source.exportName;
  const decl =
    entry.source.exportKind === "default"
      ? `export default function ${exportName}(props: Props): any { return props ? null : null; }`
      : `export function ${exportName}(props: Props): any { return props ? null : null; }`;
  return `import type { ComponentChildren } from "preact";\ntype Props = { ${propLines} };\n${decl}\n`;
}

/** Typecheck the generated code + stubs in-memory; return diagnostic messages. */
function typecheckGenerated(generatedCode: string, entries: readonly ComponentDefinition[]): string[] {
  const options: ts.CompilerOptions = {
    jsx: ts.JsxEmit.ReactJSX,
    jsxImportSource: "preact",
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ESNext,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  };

  const generatedPath = `${VDIR}/generated.tsx`;
  const virtual = new Map<string, string>();
  virtual.set(generatedPath, generatedCode);

  const specifierToStub = new Map<string, string>();
  for (const entry of entries) {
    const stubPath = `${VDIR}/stubs/${sanitize(entry.source.module)}.tsx`;
    virtual.set(stubPath, stubFor(entry));
    specifierToStub.set(entry.source.module, stubPath);
  }

  const host = ts.createCompilerHost(options, true);
  const origGetSourceFile = host.getSourceFile.bind(host);
  const origFileExists = host.fileExists.bind(host);
  const origReadFile = host.readFile.bind(host);

  host.fileExists = (f) => virtual.has(f) || origFileExists(f);
  host.readFile = (f) => (virtual.has(f) ? virtual.get(f) : origReadFile(f));
  host.getSourceFile = (fileName, langVersion, onError) => {
    const content = virtual.get(fileName);
    if (content !== undefined) {
      return ts.createSourceFile(fileName, content, langVersion, true, ts.ScriptKind.TSX);
    }
    return origGetSourceFile(fileName, langVersion, onError);
  };
  host.resolveModuleNameLiterals = (literals, containingFile) => {
    return literals.map((lit) => {
      const spec = lit.text;
      const stub = specifierToStub.get(spec);
      if (stub) {
        return {
          resolvedModule: { resolvedFileName: stub, extension: ts.Extension.Tsx },
        } as ts.ResolvedModuleWithFailedLookupLocations;
      }
      const resolved = ts.resolveModuleName(spec, containingFile, options, {
        fileExists: host.fileExists,
        readFile: host.readFile,
      });
      return { resolvedModule: resolved.resolvedModule } as ts.ResolvedModuleWithFailedLookupLocations;
    });
  };

  const program = ts.createProgram([generatedPath], options, host);
  const ours = new Set(virtual.keys());
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => (d.file ? ours.has(d.file.fileName) : true))
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

/** A comprehensive document exercising every generator feature at once. */
function comprehensiveDocument() {
  return {
    schemaVersion: COMPOSITION_SCHEMA_VERSION,
    id: "tc",
    name: "TypecheckFixture",
    root: [
      node(
        C.splitLayout,
        { ratio: "50-50", gap: "md" },
        {
          [S.splitLeft]: [
            node(
              C.sectionHeading,
              // multiline + quote + backslash string prop — MUST become an
              // expression attribute and still typecheck.
              { heading: 'Line 1\nLine 2 with "quotes" and a \\ backslash', as: "h2" },
              {},
              "heading",
            ),
          ],
          [S.splitRight]: [
            node(
              C.stack,
              { gap: "md" },
              {
                [S.stackChildren]: [
                  node(C.prose, { children: "A\nmultiline body", size: "md" }, {}, "prose"),
                  node(X.box, { label: "Box", size: 4 }, {}, "box"),
                ],
              },
              "stack",
            ),
            node(C.ctaButton, { href: "/go", variant: "solid", arrow: true, children: "Go" }, {}, "cta"),
            node(X.widgetA, {}, {}, "wa"),
            node(X.widgetB, {}, {}, "wb"),
          ],
        },
        "split",
      ),
    ],
  };
}

describe("generated fixture parses + typechecks as Preact JSX", () => {
  it("generates unblocked JSX with a multiline/quote/backslash expression prop", () => {
    const result = generateJsx(comprehensiveDocument(), M);
    expect(result.ok).toBe(true);
    expect(result.blocked).toBe(false);
    // required multiline + quote-bearing string prop, emitted as an expression
    expect(result.code).toContain("heading={");
    expect(result.code).not.toContain('heading="Line 1');
    expect(result.code).toContain('\\"quotes\\"');
  });

  it("typechecks with zero diagnostics against its emitted imports", () => {
    const result = generateJsx(comprehensiveDocument(), M);
    const diagnostics = typecheckGenerated(result.code, fixtureEntries);
    expect(diagnostics).toEqual([]);
  });
});
