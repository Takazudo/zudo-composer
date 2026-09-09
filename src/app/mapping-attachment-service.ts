import type { ComponentCatalog, CompositionDocument, CompositionNode } from "../composer/model/types";
import type { CompositionRecordRef } from "../composer/library";
import { evaluateCollectionQuery, type MappingRecordRef } from "../mapping";
import type { MappingAttachmentCallbacks, MappingAttachmentDiagnostic, MappingAttachmentItem, MappingAttachmentPreview, MappingAttachmentSnapshot, MappingAttachmentTarget } from "../features/mapping/attachments";
import { type SiteProjectCompilation } from "../site-project/compiler";
import { compileWithCapturedAsset } from "../site-project/assets/compile";
import type { VersionedAssetStore } from "../assets/library";
import { serializeSiteProject } from "../site-project/model/canonical";
import { browserProviderIdFor, validateSiteProject, type SiteProject, type SiteProjectCollectionAttachment } from "../site-project";
import { activeSiteProjectValidationContext } from "./site-project-manifest";
import type { WorkspaceRecord } from "./workspace-record";

interface MappingAttachmentServiceOptions {
  getCurrentSiteProject(options?: { flushSessions?: boolean }): Promise<{ status: "ready"; project: SiteProject } | { status: "error"; error: Error }>;
  workspace: {
    metadata(options?: { ensureReady?: boolean }): Promise<WorkspaceRecord>;
    updateMetadata(expectedToken: number, patch: { collectionAttachments?: readonly SiteProjectCollectionAttachment[] }): Promise<WorkspaceRecord>;
  };
  componentCatalog: ComponentCatalog;
  assetStore?: VersionedAssetStore;
  subscribe(listener: () => void): () => void;
}

interface ProjectContext {
  project: SiteProject;
  metadata: WorkspaceRecord;
}

interface ResolvedAttachmentData {
  target: MappingAttachmentTarget;
  mappingName: string;
  effectiveEntries: readonly import("../content").ContentEntryRecord[];
  staticFallback: CompositionDocument;
  diagnostics: readonly MappingAttachmentDiagnostic[];
}

function errorMessage(cause: unknown, fallback: string): string { return cause instanceof Error && cause.message ? cause.message : fallback; }

const workspaceMutationLocks = new Map<string, Promise<unknown>>();

async function withWorkspaceMutationLock<T>(workspaceId: string, action: () => Promise<T>): Promise<T> {
  const name = `zudo-composer-workspace-mapping-${workspaceId}`;
  if (typeof navigator !== "undefined" && navigator.locks) return navigator.locks.request(name, action);
  const previous = workspaceMutationLocks.get(name) ?? Promise.resolve();
  const next = previous.then(action, action);
  const settled = next.then(() => undefined, () => undefined);
  workspaceMutationLocks.set(name, settled);
  try { return await next; }
  finally { if (workspaceMutationLocks.get(name) === settled) workspaceMutationLocks.delete(name); }
}

function refKey(ref: { providerId: string; recordId: string }): string { return `${ref.providerId}\u0000${ref.recordId}`; }
function targetKey(composition: { providerId: string; recordId: string }, nodeId: string, slotId: string): string { return `${composition.providerId}\u0000${composition.recordId}\u0000${nodeId}\u0000${slotId}`; }
function attachmentIdentity(attachment: SiteProjectCollectionAttachment): string { return `${attachment.id}\u0000${refKey(attachment.composition)}\u0000${attachment.target.nodeId}\u0000${attachment.target.slotId}\u0000${refKey(attachment.mapping)}`; }

function walkNodes(nodes: readonly CompositionNode[], visit: (node: CompositionNode) => void): void {
  for (const node of nodes) {
    visit(node);
    for (const children of Object.values(node.slots)) walkNodes(children, visit);
  }
}

function projectComposition(project: SiteProject, ref: { providerId: string; recordId: string }): SiteProject["providers"]["compositions"][number]["records"][number] | undefined {
  return project.providers.compositions.find((provider) => provider.id === ref.providerId)?.records.find((record) => record.id === ref.recordId);
}

function projectMapping(project: SiteProject, ref: MappingRecordRef): SiteProject["providers"]["mappings"][number]["records"][number] | undefined {
  return project.providers.mappings.find((provider) => provider.id === ref.providerId)?.records.find((record) => record.id === ref.recordId);
}

function projectContent(project: SiteProject, ref: { providerId: string; recordId: string }): { model: SiteProject["providers"]["content"][number]["models"][number]; entries: readonly import("../content").ContentEntryRecord[] } | undefined {
  const provider = project.providers.content.find((candidate) => candidate.id === ref.providerId);
  const model = provider?.models.find((candidate) => candidate.id === ref.recordId);
  return model && provider ? { model, entries: provider.entries.filter((entry) => entry.modelId === model.id) } : undefined;
}

function attachmentTargets(project: SiteProject, componentCatalog: ComponentCatalog): readonly MappingAttachmentTarget[] {
  const targets: MappingAttachmentTarget[] = [];
  for (const provider of project.providers.compositions) {
    const browserProviderId = browserProviderIdFor("compositions", provider.id);
    for (const composition of provider.records) {
      walkNodes(composition.document.root, (node) => {
        const component = componentCatalog.get(node.componentId);
        for (const slot of component?.slots ?? []) targets.push({
          composition: { providerId: browserProviderId as CompositionRecordRef["providerId"], recordId: composition.id },
          compositionName: composition.document.name,
          nodeId: node.id,
          slotId: slot.id,
          slotLabel: slot.label,
          componentId: node.componentId,
          cardinality: slot.cardinality,
          ...(slot.accepts ? { accepts: [...slot.accepts] } : {}),
        });
      });
    }
  }
  return targets;
}

function placeholderTarget(project: SiteProject, attachment: SiteProjectCollectionAttachment): MappingAttachmentTarget {
  const composition = projectComposition(project, attachment.composition);
  return {
    composition: { providerId: attachment.composition.providerId, recordId: attachment.composition.recordId },
    compositionName: composition?.document.name ?? `Missing Composition (${attachment.composition.recordId})`,
    nodeId: attachment.target.nodeId,
    slotId: attachment.target.slotId,
    slotLabel: "Missing named slot",
    componentId: "missing-component",
    cardinality: "many",
  };
}

function compilerDiagnostics(compilation: SiteProjectCompilation, attachmentId: string): MappingAttachmentDiagnostic[] {
  if (compilation.status === "ready") return [];
  const attachmentPath = `$.collectionAttachments[?(@.id==${JSON.stringify(attachmentId)})]`;
  return compilation.diagnostics
    .filter((diagnostic) => diagnostic.path === "$.assetLock" || diagnostic.path === "$.collectionAttachments" || diagnostic.path.startsWith(attachmentPath))
    .map((diagnostic) => ({ code: diagnostic.code, severity: "blocking" as const, message: diagnostic.message, path: diagnostic.path }));
}

function compiledOwnerDocument(compilation: SiteProjectCompilation, attachment: SiteProjectCollectionAttachment): CompositionDocument | undefined {
  if (compilation.status !== "ready") return compilation.routes.find((route) => refKey(route.composition.local) === refKey(attachment.composition))?.composition.document;
  return compilation.build.routes.find((route) => refKey(route.composition.local) === refKey(attachment.composition))?.composition.document;
}

function mappingDiagnostic(message: string, code = "attachment-preview-unavailable"): MappingAttachmentDiagnostic { return { code, severity: "nonblocking", message }; }

function queryDiagnostics(diagnostics: readonly { code: string; severity: "blocking" | "nonblocking"; message: string; fieldId?: string; entryId?: string }[]): MappingAttachmentDiagnostic[] {
  return diagnostics.map((diagnostic) => ({ code: `query-${diagnostic.code}`, severity: diagnostic.severity, message: diagnostic.message, ...(diagnostic.fieldId ? { path: `$.query.conditions[?(@.fieldId==${JSON.stringify(diagnostic.fieldId)})]` } : diagnostic.entryId ? { path: `$.query.pins[?(@.recordId==${JSON.stringify(diagnostic.entryId)})]` } : {}) }));
}

export function createMappingAttachmentService(options: MappingAttachmentServiceOptions): MappingAttachmentCallbacks {
  let operation: Promise<unknown> = Promise.resolve();

  async function coherent(flushSessions = true): Promise<ProjectContext> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const before = await options.workspace.metadata({ ensureReady: false });
      const current = await options.getCurrentSiteProject({ flushSessions });
      if (current.status === "error") throw current.error;
      const after = await options.workspace.metadata({ ensureReady: false });
      if (before.mutationToken === after.mutationToken) return { project: current.project, metadata: after };
    }
    throw new Error("Workspace changed while reading collection attachments; retry.");
  }

  async function withOperation<T>(action: () => Promise<T>): Promise<T> {
    const next = operation.then(action, action);
    operation = next;
    return next;
  }

  async function withWorkspaceOperation<T>(action: () => Promise<T>): Promise<T> {
    const metadata = await options.workspace.metadata({ ensureReady: false });
    return withWorkspaceMutationLock(metadata.id, action);
  }

  function assertAttachmentReferences(metadata: WorkspaceRecord, mapping: MappingRecordRef | null): void {
    const referenced = metadata.metadata.collectionAttachments.some((attachment) => mapping === null || refKey(attachment.mapping) === refKey(mapping));
    if (!referenced) return;
    if (mapping === null) throw new Error("Mapping mutations are blocked because collection attachments are still persisted. Detach every collection attachment first.");
    throw new Error("This Mapping is attached to a Composition named slot. Detach every collection attachment before mutating it.");
  }

  async function withMappingMutation<T>(mapping: MappingRecordRef | null, action: () => Promise<T>): Promise<T> {
    return withWorkspaceOperation(async () => {
      const metadata = await options.workspace.metadata({ ensureReady: false });
      assertAttachmentReferences(metadata, mapping);
      return action();
    });
  }

  async function resolveData(project: SiteProject, attachment: SiteProjectCollectionAttachment): Promise<ResolvedAttachmentData> {
    const target = attachmentTargets(project, options.componentCatalog).find((candidate) => targetKey(candidate.composition, candidate.nodeId, candidate.slotId) === targetKey(attachment.composition, attachment.target.nodeId, attachment.target.slotId));
    if (!target) throw new Error("Collection attachment target is no longer a current named slot.");
    const mapping = projectMapping(project, attachment.mapping);
    if (!mapping) throw new Error("Collection attachment Mapping was not found.");
    if (mapping.document.mode.kind !== "collection") throw new Error("Collection attachment Mapping is not in collection mode.");
    const content = projectContent(project, mapping.document.contentModel);
    if (!content) throw new Error("Collection attachment Content model was not found.");
    const query = evaluateCollectionQuery({ model: content.model, providerId: mapping.document.contentModel.providerId, entries: content.entries, query: mapping.document.mode.query });
    return { target, mappingName: mapping.document.name, effectiveEntries: query.entries, staticFallback: projectComposition(project, attachment.composition)?.document ?? (() => { throw new Error("Attachment owner Composition was not found."); })(), diagnostics: queryDiagnostics(query.diagnostics) };
  }

  async function compile(project: SiteProject, baseline?: ProjectContext): Promise<SiteProjectCompilation> {
    const revision = baseline ? serializeSiteProject(baseline.project) : undefined;
    return compileWithCapturedAsset(project, { catalog: options.componentCatalog, assetStore: options.assetStore,
      ...(baseline ? { checkBaseline: async () => { const current = await coherent(false); return current.metadata.mutationToken === baseline.metadata.mutationToken && serializeSiteProject(current.project) === revision; } } : {}),
    });
  }

  async function list(): Promise<MappingAttachmentSnapshot> {
    const { project } = await coherent();
    const compilation = await compile(project);
    const items: MappingAttachmentItem[] = [];
    for (const attachment of [...project.collectionAttachments].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))) {
      try {
        const data = await resolveData(project, attachment);
        const materializedDocument = compiledOwnerDocument(compilation, attachment);
        items.push({ attachment, target: data.target, mapping: attachment.mapping, mappingName: data.mappingName, effectiveEntries: data.effectiveEntries, ...(materializedDocument ? { materializedDocument } : {}), staticFallback: data.staticFallback, diagnostics: [...data.diagnostics, ...compilerDiagnostics(compilation, attachment.id)] });
      } catch (cause) {
        const target = attachmentTargets(project, options.componentCatalog).find((candidate) => targetKey(candidate.composition, candidate.nodeId, candidate.slotId) === targetKey(attachment.composition, attachment.target.nodeId, attachment.target.slotId));
        items.push({ attachment, target: target ?? placeholderTarget(project, attachment), mapping: attachment.mapping, mappingName: attachment.mapping.recordId, effectiveEntries: [], staticFallback: dataFallback(project, attachment), diagnostics: [{ code: "attachment-invalid", severity: "blocking", message: errorMessage(cause, "Collection attachment could not be resolved."), path: `$.collectionAttachments[?(@.id==${JSON.stringify(attachment.id)})]` }] });
      }
    }
    return { targets: attachmentTargets(project, options.componentCatalog), attachments: items };
  }

  function dataFallback(project: SiteProject, attachment: SiteProjectCollectionAttachment): CompositionDocument | undefined { return projectComposition(project, attachment.composition)?.document; }

  async function attach(request: Parameters<MappingAttachmentCallbacks["attach"]>[0]): Promise<void> {
    return withOperation(() => withWorkspaceOperation(async () => {
      const context = await coherent(false);
      const composition = projectComposition(context.project, request.composition);
      const mapping = projectMapping(context.project, request.mapping);
      if (!composition) throw new Error("Attachment owner Composition was not found.");
      if (!mapping || mapping.document.mode.kind !== "collection") throw new Error("Choose a current collection Mapping.");
      const target = attachmentTargets(context.project, options.componentCatalog).find((candidate) => targetKey(candidate.composition, candidate.nodeId, candidate.slotId) === targetKey(request.composition, request.target.nodeId, request.target.slotId));
      if (!target) throw new Error("Choose a current named slot.");
      if (context.project.collectionAttachments.some((attachment) => targetKey(attachment.composition, attachment.target.nodeId, attachment.target.slotId) === targetKey(request.composition, request.target.nodeId, request.target.slotId))) throw new Error("That named slot already has a collection attachment.");
      const id = `attachment-${crypto.randomUUID().replaceAll("-", "")}`;
      const attachment: SiteProjectCollectionAttachment = { id, order: context.project.collectionAttachments.reduce((max, item) => Math.max(max, item.order), -1) + 1, composition: { providerId: request.composition.providerId as SiteProjectCollectionAttachment["composition"]["providerId"], recordId: request.composition.recordId }, target: { ...request.target }, mapping: { providerId: request.mapping.providerId as SiteProjectCollectionAttachment["mapping"]["providerId"], recordId: request.mapping.recordId } };
      const candidate = structuredClone(context.project);
      candidate.collectionAttachments.push(attachment);
      const validation = validateSiteProject(candidate, activeSiteProjectValidationContext);
      if (!validation.ok) throw new Error(validation.diagnostics.map((diagnostic) => diagnostic.message).join("; "));
      const compilation = await compile(validation.project, context);
      const attachmentDiagnostics = compilerDiagnostics(compilation, id);
      if (attachmentDiagnostics.some((diagnostic) => diagnostic.severity === "blocking")) throw new Error(attachmentDiagnostics.map((diagnostic) => diagnostic.message).join("; "));
      await options.workspace.updateMetadata(context.metadata.mutationToken, { collectionAttachments: candidate.collectionAttachments });
    }));
  }

  async function detach(attachment: SiteProjectCollectionAttachment): Promise<void> {
    return withOperation(() => withWorkspaceOperation(async () => {
      const context = await coherent(false);
      const current = context.project.collectionAttachments.find((candidate) => candidate.id === attachment.id);
      if (!current || attachmentIdentity(current) !== attachmentIdentity(attachment)) throw new Error("Collection attachment changed; reload before detaching.");
      const next = context.project.collectionAttachments.filter((candidate) => candidate.id !== attachment.id);
      const candidate = structuredClone(context.project);
      candidate.collectionAttachments = next;
      const validation = validateSiteProject(candidate, activeSiteProjectValidationContext);
      if (!validation.ok && validation.diagnostics.some((diagnostic) => !diagnostic.path.startsWith("$.collectionAttachments"))) throw new Error(validation.diagnostics.map((diagnostic) => diagnostic.message).join("; "));
      await options.workspace.updateMetadata(context.metadata.mutationToken, { collectionAttachments: next });
    }));
  }

  async function preview(attachment: SiteProjectCollectionAttachment): Promise<MappingAttachmentPreview> {
    const context = await coherent();
    const current = context.project.collectionAttachments.find((candidate) => candidate.id === attachment.id);
    if (!current || attachmentIdentity(current) !== attachmentIdentity(attachment)) throw new Error("Collection attachment changed; reload before previewing.");
    const data = await resolveData(context.project, attachment);
    const compilation = await compile(context.project);
    const diagnostics = [...data.diagnostics, ...compilerDiagnostics(compilation, attachment.id)];
    const document = compiledOwnerDocument(compilation, attachment);
    return { status: diagnostics.some((diagnostic) => diagnostic.severity === "blocking") ? "blocked" : document ? "ready" : "unavailable", ...(document ? { document } : {}), staticFallback: data.staticFallback, effectiveEntries: data.effectiveEntries, diagnostics: diagnostics.length ? diagnostics : document ? [] : [mappingDiagnostic("The owner Composition is not currently delivered by the active Sitemap.")] };
  }

  async function assertMappingDeletable(mapping: MappingRecordRef): Promise<void> {
    await withOperation(() => withWorkspaceOperation(async () => {
      const metadata = await options.workspace.metadata({ ensureReady: false });
      assertAttachmentReferences(metadata, mapping);
    }));
  }

  return {
    list,
    attach,
    detach,
    preview,
    assertMappingDeletable,
    withMappingMutation,
    async flush() { await operation; },
    subscribe: options.subscribe,
  };
}
