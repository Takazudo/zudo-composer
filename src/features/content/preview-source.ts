import type { ComponentCatalog, CompositionDocument } from "../../composer/model/types";
import type { ContentModelRef } from "../../content/catalog";
import type { ContentEntryRecord } from "../../content/model";
import {
  evaluateResolvedMapping,
  resolveMappingDefinition,
  type CompositionCatalog,
  type MappingCatalog,
  type MappingCatalogEntry,
  type MappingDefinitionDiagnostic,
  type MappingDefinitionResolution,
  type MappingEntryDiagnostic,
  type MappingEvaluationResult,
  type MappingRecordRef,
} from "../../mapping";

export interface ContentPreviewFailure {
  scope: "initialization" | "catalog" | "candidate";
  providerId?: string;
  mappingRef?: MappingRecordRef;
  message: string;
}

export interface ContentPreviewCandidate {
  ref: MappingRecordRef;
  providerLabel: string;
  summary: MappingCatalogEntry["summary"];
  status: "ready" | "broken";
  definition?: MappingDefinitionResolution;
  diagnostics: readonly MappingDefinitionDiagnostic[];
}

export interface ContentPreviewContext {
  mapping: { ref: MappingRecordRef; id: string; name: string };
  composition: { providerId: string; recordId: string; id: string; name: string };
  contentModel: { ref: ContentModelRef; id: string; name: string };
  entry: { providerId: string; modelId: string; entryId: string };
  appliedBindingCount: number;
  appliedBindings: MappingEvaluationResult["appliedBindings"];
  unchangedStaticCount: number;
  diagnostics: readonly (MappingDefinitionDiagnostic | MappingEntryDiagnostic)[];
}

export interface ContentPreviewState {
  phase: "idle" | "loading" | "ready" | "error";
  requestRevision: number;
  entryRevision: number;
  modelRef: ContentModelRef | null;
  candidates: readonly ContentPreviewCandidate[];
  selectedRef: MappingRecordRef | null;
  evaluation: MappingEvaluationResult | null;
  document: CompositionDocument | null;
  context: ContentPreviewContext | null;
  failures: readonly ContentPreviewFailure[];
  message: string;
}

export interface ContentPreviewInitializationOutcome { status: "ready" | "error"; reason?: string }

export interface ContentPreviewSourceOptions {
  mappings: MappingCatalog;
  catalogs: { content: import("../../content/catalog").ContentCatalog; compositions: CompositionCatalog };
  manifest: ComponentCatalog;
  /** Content must be initialized before Mapping because seeded Mappings reference Content records. */
  initializeContent: () => Promise<ContentPreviewInitializationOutcome>;
  initializeMappings: () => Promise<ContentPreviewInitializationOutcome>;
}

const initialState: ContentPreviewState = {
  phase: "idle", requestRevision: 0, entryRevision: 0, modelRef: null, candidates: [], selectedRef: null,
  evaluation: null, document: null, context: null, failures: [], message: "Preview has not been loaded.",
};

function sameRef(left: { providerId: string; recordId: string } | null, right: { providerId: string; recordId: string } | null): boolean {
  return Boolean(left && right && left.providerId === right.providerId && left.recordId === right.recordId);
}

function initializationFailure(outcome: ContentPreviewInitializationOutcome, fallback: string): string | null {
  return outcome.status === "ready" ? null : outcome.reason ?? fallback;
}

/** Session-scoped read model for evaluating unsaved Content Entries through compatible Mappings. */
export class ContentPreviewSource {
  private current: ContentPreviewState = initialState;
  private readonly listeners = new Set<(state: ContentPreviewState) => void>();
  private requestRevision = 0;

  constructor(private readonly options: ContentPreviewSourceOptions) {}

  get state(): ContentPreviewState { return this.current; }
  subscribe(listener: (state: ContentPreviewState) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  /** Resolves candidates once for a provider-qualified model transition. */
  async load(modelRef: ContentModelRef, entry: ContentEntryRecord): Promise<ContentPreviewState> {
    const revision = ++this.requestRevision;
    const previousSelected = sameRef(this.current.modelRef, modelRef) ? this.current.selectedRef : null;
    this.set({ ...this.current, phase: "loading", requestRevision: revision, modelRef: { ...modelRef }, candidates: [], selectedRef: null, evaluation: null, document: null, context: null, failures: [], message: "Loading compatible Mappings…" });

    try {
      const contentInitialization = await this.options.initializeContent();
      if (revision !== this.requestRevision) return this.current;
      const contentFailure = initializationFailure(contentInitialization, "Content storage could not be initialized.");
      if (contentFailure) return this.fail(revision, modelRef, contentFailure);

      const mappingInitialization = await this.options.initializeMappings();
      if (revision !== this.requestRevision) return this.current;
      const mappingFailure = initializationFailure(mappingInitialization, "Mapping storage could not be initialized.");
      if (mappingFailure) return this.fail(revision, modelRef, mappingFailure);

      const listed = await this.options.mappings.list();
      if (revision !== this.requestRevision) return this.current;
      const failures: ContentPreviewFailure[] = listed.failures.map((failure) => ({ scope: "catalog", providerId: failure.providerId, message: `${failure.providerLabel}: ${failure.reason}` }));
      const resolved = await Promise.all(listed.entries.map((candidate) => this.resolveCandidate(candidate, modelRef)));
      if (revision !== this.requestRevision) return this.current;

      const candidates: ContentPreviewCandidate[] = [];
      for (const result of resolved) {
        if (!result) continue;
        if (result.candidate) candidates.push(result.candidate);
        if (result.failure) failures.push(result.failure);
      }
      const previous = candidates.find((candidate) => candidate.status === "ready" && sameRef(candidate.ref, previousSelected));
      const selected = previous ?? candidates.find((candidate) => candidate.status === "ready") ?? null;
      this.set({
        ...this.current,
        phase: "ready",
        requestRevision: revision,
        modelRef: { ...modelRef },
        candidates,
        selectedRef: selected ? { ...selected.ref } : null,
        failures,
        evaluation: null,
        document: null,
        context: null,
        message: selected ? "Compatible Mapping ready." : candidates.length ? "Compatible Mappings are blocked." : "No compatible Mapping is available.",
      });
      if (selected) this.evaluate(entry);
      return this.current;
    } catch (error) {
      if (revision !== this.requestRevision) return this.current;
      return this.fail(revision, modelRef, error instanceof Error ? error.message : "Content preview could not be loaded.");
    }
  }

  /** Changes only the session selection; no Mapping record is written. */
  select(ref: MappingRecordRef, entry: ContentEntryRecord): ContentPreviewState {
    const candidate = this.current.candidates.find((item) => item.status === "ready" && sameRef(item.ref, ref));
    if (!candidate) return this.current;
    this.set({ ...this.current, selectedRef: { ...candidate.ref }, evaluation: null, document: null, context: null, message: "Compatible Mapping selected." });
    return this.evaluate(entry);
  }

  /** Pure synchronous evaluation of the current in-memory Entry revision. */
  evaluate(entry: ContentEntryRecord): ContentPreviewState {
    const candidate = this.current.candidates.find((item) => item.status === "ready" && sameRef(item.ref, this.current.selectedRef));
    const definition = candidate?.definition;
    const modelRef = this.current.modelRef;
    const entryRevision = this.current.entryRevision + 1;
    if (!candidate || !definition || !modelRef) {
      this.set({ ...this.current, entryRevision, evaluation: null, document: null, context: null });
      return this.current;
    }
    const evaluation = evaluateResolvedMapping(definition, entry);
    const mapping = definition.mapping;
    const composition = definition.composition;
    const contentModel = definition.contentModel;
    const context: ContentPreviewContext | null = composition && contentModel ? {
      mapping: { ref: { ...candidate.ref }, id: mapping.id, name: mapping.document.name },
      composition: { providerId: mapping.document.composition.providerId, recordId: composition.id, id: composition.id, name: composition.document.name },
      contentModel: { ref: { ...modelRef }, id: contentModel.id, name: contentModel.document.name },
      entry: { providerId: modelRef.providerId, modelId: entry.modelId, entryId: entry.id },
      appliedBindingCount: evaluation.appliedBindingCount,
      appliedBindings: evaluation.appliedBindings,
      unchangedStaticCount: evaluation.unchangedStaticCount,
      diagnostics: [...evaluation.definitionDiagnostics, ...evaluation.entryDiagnostics],
    } : null;
    this.set({
      ...this.current,
      entryRevision,
      evaluation,
      document: evaluation.document ?? null,
      context,
      message: evaluation.status === "ready" ? "Preview is current." : "Preview has blocking diagnostics.",
    });
    return this.current;
  }

  dispose(): void {
    this.requestRevision += 1;
    this.listeners.clear();
  }

  private async resolveCandidate(candidate: MappingCatalogEntry, modelRef: ContentModelRef): Promise<{ candidate?: ContentPreviewCandidate; failure?: ContentPreviewFailure } | null> {
    try {
      const outcome = await this.options.mappings.resolve(candidate.ref);
      if (outcome.status !== "resolved") {
        const message = outcome.status === "not-found" ? "Mapping was not found." : outcome.reason;
        return {
          failure: { scope: "candidate", mappingRef: { ...candidate.ref }, message },
        };
      }
      if (!sameRef(outcome.record.document.contentModel, modelRef)) return null;
      const definition = await resolveMappingDefinition(outcome.record, this.options.catalogs, this.options.manifest);
      return {
        candidate: {
          ...candidate,
          status: definition.status === "ready" ? "ready" : "broken",
          definition,
          diagnostics: definition.diagnostics,
        },
      };
    } catch (error) {
      return {
        failure: {
          scope: "candidate",
          mappingRef: { ...candidate.ref },
          message: error instanceof Error && error.message
            ? error.message
            : `Mapping “${candidate.summary.name}” could not be resolved.`,
        },
      };
    }
  }

  private fail(revision: number, modelRef: ContentModelRef, message: string): ContentPreviewState {
    this.set({ ...this.current, phase: "error", requestRevision: revision, modelRef: { ...modelRef }, candidates: [], selectedRef: null, evaluation: null, document: null, context: null, failures: [{ scope: "initialization", message }], message });
    return this.current;
  }

  private set(state: ContentPreviewState): void {
    this.current = state;
    for (const listener of [...this.listeners]) listener(state);
  }
}

export function createContentPreviewSource(options: ContentPreviewSourceOptions): ContentPreviewSource {
  return new ContentPreviewSource(options);
}
