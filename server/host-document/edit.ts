import { join } from "node:path";
import { z } from "zod";
import { captureAuthoringWorkspace, compileAuthoringWorkspaceSnapshot, type CaptureAuthoringWorkspaceOptions } from "../authoring-workspace/capture";
import { captureHost } from "../edit/inspect";
import { editDigest } from "../edit/service";
import { executeAuthoringOperation } from "../edit/authoring-lease.mjs";
import { EditError } from "../edit/plans";
import { hostDocumentTargets } from "./render";
import { updateProps, reorderNode, removeNode, addNode } from "../../src/composer/model/commands";
import { planLinkedJsxModules } from "../../src/composer/source/plan-linked-jsx";
import { withMutationBarrier } from "../../src/shared/node-fs";
import { workspaceDomainRoots } from "../../src/shared/workspace-scope";
import { compileSiteProject } from "../../src/site-project/compiler";
import { validateSiteProject } from "../../src/site-project/model/validation";
import { localOwnerReason, mappedSlot } from "./capabilities";
import type { JsonObject } from "../../src/composer/model/types";

const name = z.string().min(1).max(256);
export const documentEditSchema = z.object({ workspaceId: name, revision: z.string().regex(/^[a-f0-9]{64}$/), pathname: name, operationId: z.uuid(), target: z.object({ renderedNodeId: name, providerId: name, recordId: name, nodeId: name }).strict(), change: z.discriminatedUnion("kind", [z.object({ kind: z.literal("field"), prop: name, value: z.json() }).strict(), z.object({ kind: z.literal("reorder"), direction: z.enum(["up", "down"]) }).strict(), z.object({ kind: z.literal("reorder-placement"), direction: z.enum(["up", "down"]) }).strict(), z.object({ kind: z.literal("remove") }).strict(), z.object({ kind: z.literal("insert"), slotId: name, componentId: name, nodeId: z.uuid() }).strict()]) }).strict();

/** One explicit human operation, validated by the same pure commands and journal used by Composition. */
export async function editHostDocument(options: CaptureAuthoringWorkspaceOptions, input: unknown) {
  return executeAuthoringOperation(options.composerConfig.workspaceRoot, () => editHostDocumentLeased(options, input));
}

async function editHostDocumentLeased(options: CaptureAuthoringWorkspaceOptions, input: unknown) {
  const request = documentEditSchema.parse(input);
  const initial = await captureHost({ config: options.composerConfig, pack: options.pack });
  if (initial.workspaceId !== request.workspaceId || options.composerConfig.authoringAuthority !== "workspace") throw new EditError("wrong-workspace", "Explicit native workspace authority is required.");
  const operationId = `host-${request.operationId}`;
  const planDigest = editDigest(request);
  const existing = await initial.stores.compositions.reviewedEditReceipt<{ planDigest: string }>(operationId);
  if (existing) { if (existing.planDigest !== planDigest) throw new EditError("conflict", "Operation id belongs to a different change."); return existing; }
  const roots = workspaceDomainRoots(options.composerConfig.paths, request.workspaceId);
  const barriers = [join(options.composerConfig.paths.data, "workspaces"), roots.content, roots.mappings, roots.sitemaps, options.composerConfig.paths.assets];
  const execute = async () => {
    const snapshot = await captureAuthoringWorkspace(options);
    if (snapshot.digest !== request.revision) throw new EditError("stale-plan", "Saved preview changed. Refresh before applying.");
    const compiled = await compileAuthoringWorkspaceSnapshot({ ...options, snapshot });
    const route = compiled.build.routes.find(value => value.pathname === request.pathname);
    // Resolve every owner coordinate independently; a repeated rendered instance is never a source id.
    const resolved = route && hostDocumentTargets(route).find(value => value.renderedNodeId === request.target.renderedNodeId && value.providerId === request.target.providerId && value.recordId === request.target.recordId && value.nodeId === request.target.nodeId);
    if (!resolved || resolved.providerId !== "files") throw new EditError("unsupported-target", "The qualified target is not part of this reviewed page.");
    const owner = request.change.kind === "reorder-placement" ? resolved.placement : resolved;
    if (!owner) throw new EditError("unsupported-scope", "This shared child has no direct local page placement. Select its placed section.");
    const ownershipReason = localOwnerReason(snapshot.project, owner);
    if (ownershipReason) throw new EditError("unsupported-scope", ownershipReason);
    const state = await captureHost({ config: options.composerConfig, pack: options.pack });
    const record = state.records.compositions.find(value => value.id === owner.recordId);
    if (!record || record.document.binding || record.document.publication?.kind === "global-template") throw new EditError("unsupported-scope", "Edit linked/global arrangement through its explicit source editor.");
    if (state.records.mappings.some(mapping => mapping.document.composition.providerId === owner.providerId && mapping.document.composition.recordId === owner.recordId)) throw new EditError("unsupported-scope", "This presentation is a shared Mapping source. Edit its explicit owner after reviewing affected uses.");
    const bound = state.records.mappings.some(mapping => mapping.document.composition.providerId === owner.providerId && mapping.document.composition.recordId === owner.recordId && mapping.document.bindings.some(binding => binding.target.nodeId === owner.nodeId && (request.change.kind !== "field" || binding.target.prop === request.change.prop)));
    if (bound) throw new EditError("unsupported-scope", "This value or node is owned by Mapping/Content. Open its shared source.");
    if (request.change.kind === "insert" && mappedSlot(snapshot.project, owner, request.change.slotId)) throw new EditError("unsupported-scope", "This slot is owned by Mapping/Content.");
    const result = request.change.kind === "insert" ? addNode(record.document, state.manifest, { parentId: owner.nodeId, slotId: request.change.slotId, index: 0 }, request.change.componentId, () => request.change.kind === "insert" ? request.change.nodeId : "") : request.change.kind === "field" ? updateProps(record.document, state.manifest, owner.nodeId, { [request.change.prop]: request.change.value } as JsonObject) : (request.change.kind === "reorder" || request.change.kind === "reorder-placement") ? reorderNode(record.document, state.manifest, owner.nodeId, request.change.direction) : removeNode(record.document, state.manifest, owner.nodeId);
    if (!result.ok) throw new EditError("component-invalid", result.error);
    const candidate = { ...record, updatedAt: new Date().toISOString(), document: result.document };
    const records = state.records.compositions.map(value => value.id === record.id ? candidate : value);
    const output = planLinkedJsxModules({ manifest: state.manifest, records, sourceOutcomes: new Map(records.map(value => [value.id, { status: "loaded" as const, record: value }])), moduleSpecifier: id => `./composition-${id}.tsx` }).byRecordId.get(record.id);
    if (!output || output.status !== "generated") throw new EditError("component-invalid", "The changed structure cannot generate valid composition output.");
    const project = structuredClone(snapshot.project);
    const provider = project.providers.compositions.find(value => value.id === owner.providerId);
    if (!provider) throw new EditError("wrong-target", "Composition provider is unavailable.");
    provider.records = provider.records.map(value => value.id === candidate.id ? candidate : value);
    const validated = validateSiteProject(project, { componentPack: options.pack.manifest });
    if (!validated.ok) throw new EditError("component-invalid", "Change violates workspace references or slot ownership.");
    const compilation = await compileSiteProject(validated.project, { componentCatalog: state.manifest, policy: "release", assetLock: snapshot.assets.lock });
    if (compilation.status !== "ready") throw new EditError("component-invalid", "Change leaves invalid routes, mappings or slots.");
    const receipt = { operationId, planDigest, workspaceId: request.workspaceId, beforeRevision: snapshot.digest, recordId: record.id, before: record, after: candidate, committedAt: new Date().toISOString() };
    return state.stores.compositions.commitReviewedEdit({ operationId, planDigest, expectedSnapshotToken: String(snapshot.tokens.compositions), changes: [{ candidate, jsx: output.code }], receipt });
  };
  const lock = (index: number): Promise<unknown> => index === barriers.length ? execute() : withMutationBarrier(barriers[index]!, () => lock(index + 1));
  return lock(0);
}
