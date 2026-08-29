// Pure linked-JSX module planning.
//
// File providers own loading records and writing module artifacts. This module
// receives their already-loaded closure plus resolver outcomes and returns a
// plan only: it deliberately imports no store/provider implementation and
// never performs filesystem or provider I/O.

import { createUuidIdFactory, type IdFactory } from "../../shared/id-factory";
import type { RecordId as CompositionRecordId } from "../../shared/record-identity";
import type { ComponentCatalog, CompositionBinding } from "../model/types";
import type { CompositionRecord } from "../library/types";
import type { CompositionLoadOutcome } from "../library/types";
import { materializeStandaloneSnapshot } from "../reuse/materialize";
import { resolveGlobalTemplateLoad } from "../reuse/resolver";
import type { GlobalTemplateResolutionOutcome } from "../reuse/types";
import { generateJsx, type JsxGenerationResult } from "./generate-jsx";

/**
 * A provider supplies module locations from the stable persisted record id.
 * The planner never derives a specifier from a Composition's editable name and
 * never interprets the return value as a filesystem path.
 */
export type CompositionModuleSpecifier = (recordId: CompositionRecordId) => string;

export type LinkedJsxModuleKind = "standalone" | "global-template" | "linked-consumer";

/** Opaque/invalid local component diagnostics remain the generator's own type. */
export interface LinkedJsxLocalComponentDiagnostic {
  kind: "local-components";
  generation: JsxGenerationResult;
}

export type LinkedJsxDependencyDiagnosticCode =
  | "duplicate-record-id"
  | "invalid-module-specifier"
  | "missing-resolution"
  | "resolution-mismatch"
  | "resolution-failed"
  | "missing-source-record"
  | "source-record-mismatch"
  | "invalid-source-template"
  | "source-module-blocked";

/** A linked dependency failure, deliberately distinct from local opaque nodes. */
export interface LinkedJsxDependencyDiagnostic {
  kind: "dependency";
  code: LinkedJsxDependencyDiagnosticCode;
  message: string;
  sourceRecordId?: string;
  outletId?: string;
  resolutionStatus?: GlobalTemplateResolutionOutcome["status"];
}

export type LinkedJsxModuleDiagnostic = LinkedJsxLocalComponentDiagnostic | LinkedJsxDependencyDiagnostic;

export interface GeneratedLinkedJsxModulePlan {
  status: "generated";
  recordId: CompositionRecordId;
  moduleSpecifier: string;
  kind: LinkedJsxModuleKind;
  code: string;
  generation: JsxGenerationResult;
}

export interface BlockedLinkedJsxModulePlan {
  status: "blocked";
  recordId: CompositionRecordId;
  moduleSpecifier?: string;
  kind: LinkedJsxModuleKind;
  diagnostic: LinkedJsxModuleDiagnostic;
}

export type LinkedJsxModulePlan = GeneratedLinkedJsxModulePlan | BlockedLinkedJsxModulePlan;

export interface LinkedJsxModuleBatchPlan {
  /** Kept in input record order so provider repair output is deterministic. */
  records: readonly LinkedJsxModulePlan[];
  /** Convenience lookup over the same immutable plan entries. */
  byRecordId: ReadonlyMap<CompositionRecordId, LinkedJsxModulePlan>;
}

export interface PlanLinkedJsxModulesOptions {
  manifest: ComponentCatalog;
  /** An already-loaded, same-provider dependency closure. No provider is accepted here. */
  records: readonly CompositionRecord[];
  /**
   * Resolver outputs, keyed by the consumer record id they were resolved for.
   * Supplying these is useful to callers that already performed resolution.
   */
  resolutions?: ReadonlyMap<CompositionRecordId, GlobalTemplateResolutionOutcome>;
  /**
   * Already-read canonical source outcomes, keyed by record id. When supplied,
   * the planner resolves each consumer directly from this immutable snapshot.
   * It is intentionally a data map, never a provider callback: planning must
   * not re-enter a store while a provider owns its serialization queue.
   */
  sourceOutcomes?: ReadonlyMap<CompositionRecordId, CompositionLoadOutcome>;
  moduleSpecifier: CompositionModuleSpecifier;
}

function sameBinding(a: CompositionBinding, b: CompositionBinding): boolean {
  return a.sourceRecordId === b.sourceRecordId && a.outletId === b.outletId;
}

function sameRecordSnapshot(a: CompositionRecord, b: CompositionRecord): boolean {
  // Records are JSON-safe at their provider boundary. Comparing the whole
  // snapshot avoids producing a consumer module against a different source
  // record than the resolver actually validated, without assuming object
  // identity or a filesystem revision scheme. Object-key order is not a
  // meaningful record difference, so canonicalize it before comparison.
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([aKey], [bKey]) => aKey.localeCompare(bKey))
          .map(([key, child]) => [key, canonicalize(child)]),
      );
    }
    return value;
  };
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}

function dependency(
  code: LinkedJsxDependencyDiagnosticCode,
  message: string,
  extras: Omit<LinkedJsxDependencyDiagnostic, "kind" | "code" | "message"> = {},
): LinkedJsxDependencyDiagnostic {
  return { kind: "dependency", code, message, ...extras };
}

function blocked(
  record: CompositionRecord,
  kind: LinkedJsxModuleKind,
  diagnostic: LinkedJsxModuleDiagnostic,
  moduleSpecifier?: string,
): BlockedLinkedJsxModulePlan {
  return {
    status: "blocked",
    recordId: record.id,
    ...(moduleSpecifier === undefined ? {} : { moduleSpecifier }),
    kind,
    diagnostic,
  };
}

function localComponentBlock(
  record: CompositionRecord,
  kind: LinkedJsxModuleKind,
  generation: JsxGenerationResult,
  moduleSpecifier: string,
): BlockedLinkedJsxModulePlan {
  return blocked(record, kind, { kind: "local-components", generation }, moduleSpecifier);
}

function linkedResolutionMessage(status: Exclude<GlobalTemplateResolutionOutcome["status"], "resolved" | "unbound">): string {
  switch (status) {
    case "missing-template":
      return "The linked Global template is unavailable, so its consumer module cannot be generated.";
    case "missing-outlet":
      return "The linked Global template no longer exposes the selected outlet.";
    case "invalid-template":
      return "The linked Global template is invalid.";
    case "nested-template":
      return "Linked Global templates cannot be nested.";
    case "self-reference":
      return "A Composition cannot import itself as its Global template.";
    case "incompatible-local-root":
      return "The consumer local root does not fit the linked Global template outlet.";
  }
}

function moduleSpecifierFor(
  record: CompositionRecord,
  callback: CompositionModuleSpecifier,
): { ok: true; value: string } | { ok: false; diagnostic: LinkedJsxDependencyDiagnostic } {
  try {
    const value = callback(record.id);
    if (typeof value !== "string" || value.trim().length === 0) {
      return {
        ok: false,
        diagnostic: dependency(
          "invalid-module-specifier",
          `The module-specifier callback did not return a non-empty specifier for composition "${record.id}".`,
        ),
      };
    }
    return { ok: true, value };
  } catch {
    return {
      ok: false,
      diagnostic: dependency(
        "invalid-module-specifier",
        `The module-specifier callback failed for composition "${record.id}".`,
      ),
    };
  }
}

function standaloneModule(
  record: CompositionRecord,
  manifest: ComponentCatalog,
  moduleSpecifier: string,
): LinkedJsxModulePlan {
  const generation = generateJsx(record.document, manifest, {
    componentName: "Composition",
    componentExport: "default",
  });
  if (!generation.ok) return localComponentBlock(record, "standalone", generation, moduleSpecifier);
  return {
    status: "generated",
    recordId: record.id,
    moduleSpecifier,
    kind: "standalone",
    code: generation.code,
    generation,
  };
}

function globalTemplateModule(
  record: CompositionRecord,
  manifest: ComponentCatalog,
  moduleSpecifier: string,
): LinkedJsxModulePlan {
  const publication = record.document.publication;
  if (publication?.kind !== "global-template") return standaloneModule(record, manifest, moduleSpecifier);

  const generation = generateJsx(record.document, manifest, {
    componentName: "Composition",
    componentExport: "default",
    linkedOutlet: publication.outlet,
  });
  if (!generation.ok) return localComponentBlock(record, "global-template", generation, moduleSpecifier);
  if (generation.diagnostics.hasReuseIssues) {
    return blocked(
      record,
      "global-template",
      dependency(
        "invalid-source-template",
        "The published Global template no longer has a valid empty outlet target.",
        { outletId: publication.outlet.id },
      ),
      moduleSpecifier,
    );
  }
  return {
    status: "generated",
    recordId: record.id,
    moduleSpecifier,
    kind: "global-template",
    code: generation.code,
    generation,
  };
}

function linkedConsumerModule(
  record: CompositionRecord,
  manifest: ComponentCatalog,
  moduleSpecifier: string,
  recordsById: ReadonlyMap<CompositionRecordId, CompositionRecord>,
  sourcePlans: ReadonlyMap<CompositionRecordId, LinkedJsxModulePlan>,
  resolutions: ReadonlyMap<CompositionRecordId, GlobalTemplateResolutionOutcome> | undefined,
  sourceOutcomes: ReadonlyMap<CompositionRecordId, CompositionLoadOutcome> | undefined,
): LinkedJsxModulePlan {
  const binding = record.document.binding!;
  const resolution = resolutions?.get(record.id)
    ?? (sourceOutcomes
      ? resolveGlobalTemplateLoad(
        record,
        sourceOutcomes.get(binding.sourceRecordId) ?? { status: "not-found", id: binding.sourceRecordId },
        manifest,
      )
      : undefined);
  const dependencyFields = { sourceRecordId: binding.sourceRecordId, outletId: binding.outletId };
  if (!resolution) {
    return blocked(
      record,
      "linked-consumer",
      dependency("missing-resolution", "The linked Composition has not been resolved before module planning.", dependencyFields),
      moduleSpecifier,
    );
  }
  if (resolution.status === "unbound" || !sameBinding(binding, resolution.binding)) {
    return blocked(
      record,
      "linked-consumer",
      dependency("resolution-mismatch", "The resolved binding does not match the consumer's current binding.", {
        ...dependencyFields,
        resolutionStatus: resolution.status,
      }),
      moduleSpecifier,
    );
  }
  if (resolution.status !== "resolved") {
    return blocked(
      record,
      "linked-consumer",
      dependency("resolution-failed", linkedResolutionMessage(resolution.status), {
        ...dependencyFields,
        resolutionStatus: resolution.status,
      }),
      moduleSpecifier,
    );
  }

  const source = recordsById.get(binding.sourceRecordId);
  if (!source) {
    return blocked(
      record,
      "linked-consumer",
      dependency("missing-source-record", "The resolved source record was not included in this module-planning batch.", dependencyFields),
      moduleSpecifier,
    );
  }
  if (!sameRecordSnapshot(source, resolution.source)) {
    return blocked(
      record,
      "linked-consumer",
      dependency("source-record-mismatch", "The source record changed after its binding was resolved; resolve it again before generating modules.", dependencyFields),
      moduleSpecifier,
    );
  }

  const sourcePlan = sourcePlans.get(source.id);
  if (!sourcePlan || sourcePlan.status !== "generated" || sourcePlan.kind !== "global-template") {
    return blocked(
      record,
      "linked-consumer",
      dependency("source-module-blocked", "The linked source module is blocked, so no misleading local-only consumer module was generated.", dependencyFields),
      moduleSpecifier,
    );
  }

  const localGeneration = generateJsx(record.document, manifest, {
    componentName: "LocalCompositionContent",
    componentExport: "none",
    reservedIdentifiers: ["Composition", "LinkedTemplate", "LocalCompositionContent"],
  });
  if (!localGeneration.ok) return localComponentBlock(record, "linked-consumer", localGeneration, moduleSpecifier);

  const sourceSpecifier = sourcePlan.moduleSpecifier;
  const code = [
    `import LinkedTemplate from ${JSON.stringify(sourceSpecifier)};`,
    "",
    localGeneration.code.trimEnd(),
    "",
    "export default function Composition() {",
    "  return (",
    "    <LinkedTemplate",
    "      outlets={{",
    `        ${JSON.stringify(resolution.outlet.id)}: <LocalCompositionContent />,`,
    "      }}",
    "    />",
    "  );",
    "}",
    "",
  ].join("\n");

  return {
    status: "generated",
    recordId: record.id,
    moduleSpecifier,
    kind: "linked-consumer",
    code,
    generation: localGeneration,
  };
}

/**
 * Produce a complete, provider-neutral module plan for an already-loaded
 * closure. No record is loaded, saved, listed, or otherwise read through a
 * provider here; callers own those operations before invoking this function.
 */
export function planLinkedJsxModules(options: PlanLinkedJsxModulesOptions): LinkedJsxModuleBatchPlan {
  const recordsById = new Map<CompositionRecordId, CompositionRecord>();
  const duplicateIds = new Set<CompositionRecordId>();
  for (const record of options.records) {
    if (recordsById.has(record.id)) duplicateIds.add(record.id);
    else recordsById.set(record.id, record);
  }

  const specifiers = new Map<CompositionRecordId, string>();
  const preflight = new Map<CompositionRecordId, LinkedJsxModulePlan>();
  for (const record of options.records) {
    if (duplicateIds.has(record.id)) {
      preflight.set(
        record.id,
        blocked(
          record,
          record.document.binding ? "linked-consumer" : record.document.publication?.kind === "global-template" ? "global-template" : "standalone",
          dependency("duplicate-record-id", `Composition "${record.id}" appears more than once in this module-planning batch.`),
        ),
      );
      continue;
    }
    const specifier = moduleSpecifierFor(record, options.moduleSpecifier);
    if (!specifier.ok) {
      preflight.set(
        record.id,
        blocked(
          record,
          record.document.binding ? "linked-consumer" : record.document.publication?.kind === "global-template" ? "global-template" : "standalone",
          specifier.diagnostic,
        ),
      );
    } else {
      specifiers.set(record.id, specifier.value);
    }
  }

  // Plan source/ordinary modules first. A consumer is only allowed to import a
  // source whose own module plan is generated in this same batch.
  const sourcePlans = new Map<CompositionRecordId, LinkedJsxModulePlan>();
  for (const record of options.records) {
    const existing = preflight.get(record.id);
    if (existing) {
      sourcePlans.set(record.id, existing);
      continue;
    }
    if (record.document.binding) continue;
    sourcePlans.set(record.id, globalTemplateModule(record, options.manifest, specifiers.get(record.id)!));
  }

  const plans = new Map<CompositionRecordId, LinkedJsxModulePlan>(sourcePlans);
  for (const record of options.records) {
    if (!record.document.binding) continue;
    const existing = preflight.get(record.id);
    plans.set(
      record.id,
      existing
        ?? linkedConsumerModule(
          record,
          options.manifest,
          specifiers.get(record.id)!,
          recordsById,
          sourcePlans,
          options.resolutions,
          options.sourceOutcomes,
        ),
    );
  }

  const ordered = options.records.map((record) => plans.get(record.id)!);
  return { records: ordered, byRecordId: new Map(plans) };
}

export type BrowserJsxExportKind = "ordinary" | "resolved-standalone-snapshot";

export interface BrowserJsxExportReady {
  status: "ready";
  kind: BrowserJsxExportKind;
  /** The existing generator result; it can still be locally blocked by opaque nodes. */
  generation: JsxGenerationResult;
  /** Explicit user-facing copy semantics. */
  message?: string;
}

export interface BrowserJsxExportBlocked {
  status: "blocked";
  diagnostic: LinkedJsxDependencyDiagnostic;
}

export type BrowserJsxExportOutcome = BrowserJsxExportReady | BrowserJsxExportBlocked;

export interface GenerateBrowserJsxExportOptions {
  record: CompositionRecord;
  manifest: ComponentCatalog;
  /** Required only when `record.document.binding` is present. */
  resolution?: GlobalTemplateResolutionOutcome | null;
  /** Injectable for deterministic tests; production defaults to UUID-like ids. */
  idFactory?: IdFactory;
}

const SNAPSHOT_NOTICE = "// Resolved standalone snapshot — future Global-template changes will not propagate to this copied code.\n";

/**
 * Generate browser Copy JSX without provider I/O. Bound records can only copy
 * a fully resolved standalone snapshot; unresolved bindings return a typed
 * block instead of silently exporting their local root by itself.
 */
export function generateBrowserJsxExport(options: GenerateBrowserJsxExportOptions): BrowserJsxExportOutcome {
  const { record, manifest } = options;
  const binding = record.document.binding;
  if (!binding) {
    return { status: "ready", kind: "ordinary", generation: generateJsx(record.document, manifest) };
  }

  const resolution = options.resolution;
  const dependencyFields = { sourceRecordId: binding.sourceRecordId, outletId: binding.outletId };
  if (!resolution) {
    return {
      status: "blocked",
      diagnostic: dependency(
        "missing-resolution",
        "The linked Global template is still resolving, so Copy JSX is unavailable.",
        dependencyFields,
      ),
    };
  }
  if (resolution.status === "unbound" || !sameBinding(binding, resolution.binding)) {
    return {
      status: "blocked",
      diagnostic: dependency("resolution-mismatch", "The resolved binding does not match the current Composition.", {
        ...dependencyFields,
        resolutionStatus: resolution.status,
      }),
    };
  }
  if (resolution.status !== "resolved") {
    return {
      status: "blocked",
      diagnostic: dependency("resolution-failed", linkedResolutionMessage(resolution.status), {
        ...dependencyFields,
        resolutionStatus: resolution.status,
      }),
    };
  }

  const materialized = materializeStandaloneSnapshot(record, resolution, options.idFactory ?? createUuidIdFactory());
  if (materialized.status === "blocked") {
    return {
      status: "blocked",
      diagnostic: dependency("resolution-failed", materialized.message, {
        ...dependencyFields,
        resolutionStatus: materialized.resolutionStatus,
      }),
    };
  }
  const generated = generateJsx(materialized.document, manifest);
  return {
    status: "ready",
    kind: "resolved-standalone-snapshot",
    generation: {
      ...generated,
      code: generated.ok ? `${SNAPSHOT_NOTICE}${generated.code}` : generated.code,
    },
    message: "Resolved standalone snapshot — future Global-template changes will not propagate to this copied code.",
  };
}
