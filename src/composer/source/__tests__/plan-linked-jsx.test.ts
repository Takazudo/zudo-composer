import { describe, expect, it } from "vitest";
import ts from "typescript";
import { Fragment, h } from "preact";
import type { ComponentChildren, ComponentType } from "preact";
import render from "preact-render-to-string";
import {
  createComponentCatalog,
  createSequentialIdFactory,
  generateBrowserJsxExport,
  planLinkedJsxModules,
  resolveGlobalTemplate,
  type ComponentDefinition,
  type CompositionNode,
  type CompositionRecord,
} from "../../index";
import { createFixturePackManifest } from "../../__tests__/fixtures";

const TIMESTAMP = "2026-07-14T00:00:00.000Z";
const VDIR = `${process.cwd()}/__linked_jsx_virtual__`;

const manifest = createComponentCatalog(createFixturePackManifest([
  {
    id: "shell",
    schemaVersion: 1,
    title: "shell",
    category: "Fixture",
    description: "shell",
    // Deliberately collides with every generated module's stable default
    // component symbol. The source generator must alias this import.
    source: { module: "@linked-test/shell", exportKind: "named", exportName: "Composition" },
    defaults: {},
    fields: [],
    slots: [
      { id: "body", prop: "body", label: "Body", cardinality: "many" },
      { id: "secondary", prop: "secondary", label: "Secondary", cardinality: "many" },
    ],
  },
  {
    id: "leaf",
    schemaVersion: 1,
    title: "leaf",
    category: "Fixture",
    description: "leaf",
    // Deliberately collides with the consumer's stable source-import name.
    source: { module: "@linked-test/leaf", exportKind: "named", exportName: "LinkedTemplate" },
    defaults: {},
    fields: [{ prop: "label", label: "Label", schema: { type: "string" }, editor: { kind: "text" } }],
    slots: [],
  },
] satisfies ComponentDefinition[]));

function node(
  id: string,
  componentId: "shell" | "leaf",
  slots: Record<string, CompositionNode[]> = {},
  props: Record<string, string> = {},
): CompositionNode {
  return { id, componentId, componentVersion: 1, props, slots };
}

function record(id: string, document: Partial<CompositionRecord["document"]> = {}): CompositionRecord {
  return {
    id,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    document: {
      schemaVersion: 2,
      id,
      name: id,
      root: [],
      ...document,
    },
  };
}

function source(name = "Shared shell", outletLabel = "Content", target = { parentId: "source-shell", slotId: "body" }) {
  return record("source", {
    name,
    root: [node("source-shell", "shell", { body: [], secondary: [] })],
    publication: {
      kind: "global-template",
      outlet: { id: "stable-outlet", label: outletLabel, target },
    },
  });
}

function consumer(name = "Consumer") {
  return record("consumer", {
    name,
    // Same canonical node id as the source shell is intentional: the files
    // must not infer an owner from bare node ids.
    root: [node("source-shell", "leaf", {}, { label: "Projected local content" })],
    binding: { sourceRecordId: "source", outletId: "stable-outlet" },
  });
}

function resolved(sourceRecord: CompositionRecord, consumerRecord: CompositionRecord) {
  const result = resolveGlobalTemplate({ consumer: consumerRecord, source: sourceRecord, manifest });
  if (result.status !== "resolved") throw new Error(`fixture did not resolve: ${result.status}`);
  return result;
}

function plan(sourceRecord: CompositionRecord, consumerRecord: CompositionRecord) {
  return planLinkedJsxModules({
    manifest,
    records: [sourceRecord, consumerRecord],
    resolutions: new Map([[consumerRecord.id, resolved(sourceRecord, consumerRecord)]]),
    moduleSpecifier: (recordId) => `@compositions/${recordId}`,
  });
}

function typecheckLinkedModules(sourceCode: string, consumerCode: string): string[] {
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
  const sourcePath = `${VDIR}/source.tsx`;
  const consumerPath = `${VDIR}/consumer.tsx`;
  const shellPath = `${VDIR}/shell.tsx`;
  const leafPath = `${VDIR}/leaf.tsx`;
  const virtual = new Map<string, string>([
    [sourcePath, sourceCode],
    [consumerPath, consumerCode],
    [shellPath, 'import type { ComponentChildren } from "preact"; export function Composition(props: { body?: ComponentChildren; secondary?: ComponentChildren }): any { return props.body ?? props.secondary ?? null; }'],
    [leafPath, 'export function LinkedTemplate(props: { label?: string }): any { return props.label ?? null; }'],
  ]);
  const modules = new Map([
    ["@compositions/source", sourcePath],
    ["@linked-test/shell", shellPath],
    ["@linked-test/leaf", leafPath],
  ]);
  const host = ts.createCompilerHost(options, true);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  host.fileExists = (file) => virtual.has(file) || originalFileExists(file);
  host.readFile = (file) => virtual.get(file) ?? originalReadFile(file);
  host.getSourceFile = (file, languageVersion, onError) => {
    const content = virtual.get(file);
    return content === undefined
      ? originalGetSourceFile(file, languageVersion, onError)
      : ts.createSourceFile(file, content, languageVersion, true, ts.ScriptKind.TSX);
  };
  host.resolveModuleNameLiterals = (literals, containingFile) => literals.map((literal) => {
    const resolved = modules.get(literal.text);
    if (resolved) {
      return {
        resolvedModule: { resolvedFileName: resolved, extension: ts.Extension.Tsx },
      } as ts.ResolvedModuleWithFailedLookupLocations;
    }
    const fallback = ts.resolveModuleName(literal.text, containingFile, options, {
      fileExists: host.fileExists,
      readFile: host.readFile,
    });
    return { resolvedModule: fallback.resolvedModule } as ts.ResolvedModuleWithFailedLookupLocations;
  });
  const program = ts.createProgram([consumerPath], options, host);
  return ts.getPreEmitDiagnostics(program)
    .filter((diagnostic) => !diagnostic.file || virtual.has(diagnostic.file.fileName))
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
}

/** Compile the two planned modules in memory and render their default export. */
function renderLinkedModules(sourceCode: string, consumerCode: string): string {
  const compilerOptions: ts.CompilerOptions = {
    jsx: ts.JsxEmit.React,
    jsxFactory: "h",
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  };
  const compile = (code: string) => ts.transpileModule(code, { compilerOptions }).outputText;
  const modules = new Map<string, Record<string, unknown>>();
  modules.set("@linked-test/shell", {
    Composition: (props: { body?: ComponentChildren; secondary?: ComponentChildren }) => h("section", { "data-linked-source": "shell" }, props.body ?? props.secondary),
  });
  modules.set("@linked-test/leaf", {
    LinkedTemplate: (props: { label?: string }) => h("span", { "data-linked-local": "leaf" }, props.label),
  });
  const execute = (code: string): Record<string, unknown> => {
    const exports: Record<string, unknown> = {};
    const require = (specifier: string): Record<string, unknown> => {
      const module = modules.get(specifier);
      if (!module) throw new Error(`Unexpected module request: ${specifier}`);
      return module;
    };
    new Function("require", "exports", "h", "React", code)(require, exports, h, { createElement: h, Fragment });
    return exports;
  };
  modules.set("@compositions/source", execute(compile(sourceCode)));
  const consumer = execute(compile(consumerCode));
  return render(h(consumer.default as ComponentType<Record<string, never>>, {}));
}

describe("planLinkedJsxModules", () => {
  it("emits a type-safe source default module and a linked consumer that projects local JSX at the stable outlet id", () => {
    const sourceRecord = source();
    const consumerRecord = consumer();
    const batch = plan(sourceRecord, consumerRecord);
    const sourcePlan = batch.byRecordId.get("source");
    const consumerPlan = batch.byRecordId.get("consumer");

    expect(sourcePlan).toMatchObject({ status: "generated", kind: "global-template", moduleSpecifier: "@compositions/source" });
    expect(consumerPlan).toMatchObject({ status: "generated", kind: "linked-consumer" });
    if (sourcePlan?.status !== "generated" || consumerPlan?.status !== "generated") throw new Error("expected generated plans");

    expect(sourcePlan.code).toContain('"stable-outlet"?: import("preact").ComponentChildren;');
    expect(sourcePlan.code).toContain('body={outlets["stable-outlet"]}');
    expect(sourcePlan.code).toContain("export default function Composition");
    expect(consumerPlan.code).toContain('import LinkedTemplate from "@compositions/source";');
    expect(consumerPlan.code).toContain('"stable-outlet": <LocalCompositionContent />');
    expect(consumerPlan.code).not.toContain("source-shell");
    expect(typecheckLinkedModules(sourcePlan.code, consumerPlan.code)).toEqual([]);
    expect(renderLinkedModules(sourcePlan.code, consumerPlan.code)).toContain(
      '<section data-linked-source="shell"><span data-linked-local="leaf">Projected local content</span></section>',
    );
  });

  it("keeps the consumer import/API stable across source and outlet-label renames, while target movement only changes the source module", () => {
    const beforeSource = source();
    const beforeConsumer = consumer();
    const before = plan(beforeSource, beforeConsumer);
    const beforeSourceCode = (before.byRecordId.get("source") as Extract<typeof before.records[number], { status: "generated" }>).code;
    const beforeConsumerCode = (before.byRecordId.get("consumer") as Extract<typeof before.records[number], { status: "generated" }>).code;

    const renamedSource = source("Renamed editable Composition", "Renamed outlet label");
    const renamedConsumer = consumer("Renamed consumer");
    const renamed = plan(renamedSource, renamedConsumer);
    const renamedSourceCode = (renamed.byRecordId.get("source") as Extract<typeof renamed.records[number], { status: "generated" }>).code;
    const renamedConsumerCode = (renamed.byRecordId.get("consumer") as Extract<typeof renamed.records[number], { status: "generated" }>).code;
    expect(renamedSourceCode).toBe(beforeSourceCode);
    expect(renamedConsumerCode).toBe(beforeConsumerCode);

    // Move the outlet onto a different real empty slot while retaining its
    // stable public outlet id. The consumer import/API must remain unchanged.
    const movedSource = source("Renamed editable Composition", "Renamed outlet label", { parentId: "source-shell", slotId: "secondary" });
    const moved = plan(movedSource, consumer());
    const movedSourceCode = (moved.byRecordId.get("source") as Extract<typeof moved.records[number], { status: "generated" }>).code;
    const movedConsumerCode = (moved.byRecordId.get("consumer") as Extract<typeof moved.records[number], { status: "generated" }>).code;
    expect(movedSourceCode).not.toBe(beforeSourceCode);
    expect(movedSourceCode).toContain('secondary={outlets["stable-outlet"]}');
    expect(movedConsumerCode).toBe(beforeConsumerCode);
  });

  it("returns a dependency block, never a local-only consumer module, when the source or outlet does not resolve", () => {
    const consumerRecord = consumer();
    const unresolved = planLinkedJsxModules({
      manifest,
      records: [consumerRecord],
      resolutions: new Map([[consumerRecord.id, {
        status: "missing-template",
        binding: consumerRecord.document.binding!,
        localRoot: consumerRecord.document.root,
        reason: "not-found",
      }]]),
      moduleSpecifier: (recordId) => `@compositions/${recordId}`,
    });
    const consumerPlan = unresolved.byRecordId.get("consumer");
    expect(consumerPlan).toMatchObject({
      status: "blocked",
      kind: "linked-consumer",
      diagnostic: { kind: "dependency", code: "resolution-failed", resolutionStatus: "missing-template" },
    });
    expect("code" in (consumerPlan ?? {})).toBe(false);

    const sourceRecord = source();
    const missingOutletConsumer = consumer();
    missingOutletConsumer.document.binding = { sourceRecordId: "source", outletId: "removed-outlet" };
    const missingOutletResolution = resolveGlobalTemplate({
      consumer: missingOutletConsumer,
      source: sourceRecord,
      manifest,
    });
    expect(missingOutletResolution.status).toBe("missing-outlet");
    const missingOutlet = planLinkedJsxModules({
      manifest,
      records: [sourceRecord, missingOutletConsumer],
      resolutions: new Map([[missingOutletConsumer.id, missingOutletResolution]]),
      moduleSpecifier: (recordId) => `@compositions/${recordId}`,
    });
    expect(missingOutlet.byRecordId.get("consumer")).toMatchObject({
      status: "blocked",
      diagnostic: { kind: "dependency", code: "resolution-failed", resolutionStatus: "missing-outlet" },
    });
  });

  it("keeps opaque local-component diagnostics distinct from dependency diagnostics", () => {
    const sourceRecord = source();
    const opaqueConsumer = consumer();
    opaqueConsumer.document.root[0]!.componentId = "unavailable.local-component";
    const result = planLinkedJsxModules({
      manifest,
      records: [sourceRecord, opaqueConsumer],
      resolutions: new Map([[opaqueConsumer.id, resolved(sourceRecord, opaqueConsumer)]]),
      moduleSpecifier: (recordId) => `@compositions/${recordId}`,
    });
    expect(result.byRecordId.get("consumer")).toMatchObject({
      status: "blocked",
      kind: "linked-consumer",
      diagnostic: {
        kind: "local-components",
        generation: { diagnostics: { opaqueIds: ["source-shell"] } },
      },
    });
  });

  it("is a pure record batch: specifiers are based only on stable record ids and no provider capability is accepted", () => {
    const sourceRecord = Object.freeze(source("Any display name"));
    const consumerRecord = Object.freeze(consumer("Another display name"));
    const receivedIds: string[] = [];
    const result = planLinkedJsxModules({
      manifest,
      records: [sourceRecord, consumerRecord],
      resolutions: new Map([[consumerRecord.id, resolved(sourceRecord, consumerRecord)]]),
      moduleSpecifier: (recordId) => {
        receivedIds.push(recordId);
        return `module:${recordId}`;
      },
    });
    expect(receivedIds).toEqual(["source", "consumer"]);
    expect(result.records.map((entry) => entry.moduleSpecifier)).toEqual(["module:source", "module:consumer"]);
  });

  it("resolves a linked consumer from already-loaded source outcomes without a provider callback", () => {
    const sourceRecord = source();
    const consumerRecord = consumer();
    const result = planLinkedJsxModules({
      manifest,
      records: [sourceRecord, consumerRecord],
      sourceOutcomes: new Map([[sourceRecord.id, { status: "loaded", record: sourceRecord }]]),
      moduleSpecifier: (recordId) => `@compositions/${recordId}`,
    });

    expect(result.byRecordId.get("consumer")).toMatchObject({
      status: "generated",
      kind: "linked-consumer",
      code: expect.stringContaining('import LinkedTemplate from "@compositions/source";'),
    });
  });
});

describe("generateBrowserJsxExport", () => {
  it("keeps ordinary unbound export compatible", () => {
    const local = record("local", { root: [node("local-node", "leaf", {}, { label: "Local" })] });
    const output = generateBrowserJsxExport({ record: local, manifest });
    expect(output).toMatchObject({ status: "ready", kind: "ordinary" });
    if (output.status !== "ready") throw new Error("expected ordinary output");
    expect(output.generation.code).toContain("export function Local");
  });

  it("materializes a resolved consumer as an explicitly labelled standalone snapshot with no source import", () => {
    const sourceRecord = source();
    const consumerRecord = consumer();
    const output = generateBrowserJsxExport({
      record: consumerRecord,
      manifest,
      resolution: resolved(sourceRecord, consumerRecord),
      idFactory: createSequentialIdFactory("snapshot"),
    });
    expect(output).toMatchObject({ status: "ready", kind: "resolved-standalone-snapshot" });
    if (output.status !== "ready") throw new Error("expected snapshot output");
    expect(output.message).toMatch(/future Global-template changes will not propagate/i);
    expect(output.generation.code).toMatch(/^\/\/ Resolved standalone snapshot/m);
    expect(output.generation.code).toContain("<Composition body={<LinkedTemplate");
    expect(output.generation.code).toContain("LinkedTemplate");
    expect(output.generation.code).not.toContain("@compositions/source");
    expect(output.generation.code).not.toContain("outlets=");
  });

  it("blocks browser Copy while a bound source is unresolved instead of exporting only the local root", () => {
    const bound = consumer();
    const output = generateBrowserJsxExport({ record: bound, manifest });
    expect(output).toMatchObject({
      status: "blocked",
      diagnostic: { kind: "dependency", code: "missing-resolution" },
    });
  });
});
