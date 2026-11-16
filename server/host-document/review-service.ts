import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import { createFilesystemCompositionStore } from "../../src/composer/storage/filesystem";
import type { ResolvedComposerConfig } from "../config/config";
import type { DraftReceipt } from "../edit/draft-service";
import type { CompositionRecord } from "../../src/composer/library/types";
import { createComponentCatalog } from "../../src/composer/model/types";
import { compileSiteProject } from "../../src/site-project/compiler";
import type { SiteProject } from "../../src/site-project/model/types";
import { projectFromWorkspace } from "../../src/app/workspace-record";
import { withMutationBarrier } from "../../src/shared/node-fs";
import { workspaceDomainRoots } from "../../src/shared/workspace-scope";
import type { ContentAiService, ContentAiPrepareResult, ContentAiStageRequest, ContentAiStageGuard } from "../../src/content/editorial/ai";
import { captureHost, type HostCapture } from "../edit/inspect";
import { editDigest, type createEditingService } from "../edit/service";
import { EditError } from "../edit/plans";
import { executeAuthoringOperation } from "../edit/authoring-lease.mjs";
import { captureAuthoringWorkspace, compileAuthoringWorkspaceSnapshot, capturePublicFiles, isAuthoringWorkspaceSnapshotCurrent, type AuthoringWorkspaceSnapshot, type CaptureAuthoringWorkspaceOptions } from "../authoring-workspace/capture";
import { hostDocumentTargets, renderHostDocument } from "./render";
import type { HostDocumentRenderer, HostDocumentIdentity } from "./types";
import { openHostReviewStore } from "./review-store";
import type { HostReviewService, HostReviewCard, HostReviewAcknowledgement, InspectedOwner, RunFence, HostSelection, ContentFieldPolicy, AffectedUse, ReviewOperation } from "../../src/features/assistant/host-review-types";

type Drafts = ReturnType<typeof createEditingService>["drafts"];
type Compilation = Awaited<ReturnType<typeof compileAuthoringWorkspaceSnapshot>>;
export interface HostReviewDependencies {
  config: ResolvedComposerConfig;
  options(): Promise<CaptureAuthoringWorkspaceOptions>;
  drafts: Drafts;
  renderer: HostDocumentRenderer;
  documentCache: { put(html: string, visitorUrl?: string): string };
  assertSourcesCurrent(): Promise<void>;
  content(workspaceId: string): Promise<{ service: ContentAiService; stage(request: ContentAiStageRequest, guard: ContentAiStageGuard): Promise<ContentAiPrepareResult>; recover(request: ContentAiStageRequest, guard: ContentAiStageGuard): Promise<ContentAiPrepareResult | null> }>;
  resolveOwnership(input: { snapshot: AuthoringWorkspaceSnapshot; compiled: Compilation; selection: HostSelection; manifest: CaptureAuthoringWorkspaceOptions["pack"]["manifest"]; contentFields: readonly ContentFieldPolicy[] }): Omit<InspectedOwner, "capabilityId">;
}
interface Envelope { preparationDigest?: string; schemaVersion: 1; id: string; host: string; policyDigest: string; base: AuthoringWorkspaceSnapshot; project: SiteProject; card: HostReviewCard; integrity: string }
const name = z.string().min(1).max(256), hash = z.string().regex(/^[a-f0-9]{64}$/);
const ref = z.object({ workspaceId: name, reviewId: z.string().regex(/^review-[a-f0-9]{64}$/) }).strict();
const selectionSchema = z.object({ revision: hash, pathname: z.string().startsWith("/").max(2048), target: z.object({ renderedNodeId: name, providerId: name, recordId: name, nodeId: name }).strict(), prop: name.optional() }).strict();
const identitySchema = z.object({ workspaceId: name, revision: hash, pathname: name, packId: name, packVersion: name, rendererId: name, rendererVersion: name, rendererDigest: hash }).strict();
const acknowledgementSchema = z.object({ reviewId: ref.shape.reviewId, candidateDigest: hash, baseDigest: hash, identity: identitySchema, frameId: z.uuid() }).strict();
const same = (a: unknown, b: unknown) => editDigest(a) === editDigest(b);
const failure = (message: string, code = "stale-plan"): never => { throw new EditError(code, message); };
const active = async (fence: RunFence) => { fence.signal.throwIfAborted(); await fence.assertActive(); fence.signal.throwIfAborted(); };
const runKey = (fence: RunFence) => `${fence.conversationId}/${fence.runId}`;
const policy = (options: CaptureAuthoringWorkspaceOptions) => editDigest({ fields: options.composerConfig.assistant?.contentFields ?? [], permission: options.composerConfig.assistant?.permission ?? "propose" });

/** Immutable, owner-specific host review. No model-accessible canonical writes. */
export function createHostReviewService(deps: HostReviewDependencies): HostReviewService {
  type Capability = { id: string; host: string; run: string; inspected: InspectedOwner; snapshot: AuthoringWorkspaceSnapshot; integrity: string };
  const capabilities = new Map<string, Capability>();
  let capabilityStorage: ReturnType<typeof openHostReviewStore<Capability>> | undefined;
  const capabilityStore = () => capabilityStorage ??= openHostReviewStore<Capability>(join(deps.config.paths.data, "host-owner-capabilities"));
  const previews = new Map<string, HostReviewAcknowledgement>();
  let storage: ReturnType<typeof openHostReviewStore<Envelope>> | undefined;
  const store = async () => storage ??= openHostReviewStore<Envelope>(deps.config.paths.data);
  const leased = async <T>(task: () => Promise<T>) => executeAuthoringOperation(deps.config.workspaceRoot, task);
  const load = async (input: { workspaceId: string; reviewId: string }) => {
    ref.parse(input);
    const value = await (await store()).read(input.reviewId);
    if (!value) return failure("Host review not found.", "not-found");
    const { integrity, ...body } = value;
    if (value.schemaVersion !== 1 || !same(integrity, editDigest(body))) return failure("Stored host review changed.", "tampered-plan");
    if (value.host !== await realpath(deps.config.workspaceRoot) || value.card.workspaceId !== input.workspaceId) return failure("Host review belongs to another workspace.", "wrong-workspace");
    return value;
  };
  const compile = async (base: AuthoringWorkspaceSnapshot, project: SiteProject) => {
    const options = await deps.options();
    const result = await compileSiteProject(project, { componentCatalog: createComponentCatalog(options.pack.manifest), policy: "release", assetLock: base.assets.lock });
    if (result.status !== "ready") return failure("Candidate is not a complete renderable workspace: " + result.diagnostics.map(item => item.message).join(" "), "component-invalid");
    return result.build;
  };
  const persist = async (base: AuthoringWorkspaceSnapshot, project: SiteProject, operation: ReviewOperation, summary: string, ownerLabel: string, affectedUses: readonly AffectedUse[], preparation?: { id: string; digest: string }, fence?: RunFence) => {
    const options = await deps.options();
    const build = await compile(base, project);
    const routes = build.routes.filter(route => affectedUses.some(use => use.pathname === route.pathname)).map(route => ({ pathname: route.pathname, title: route.displayTitle }));
    if (!routes.length) return failure("This edit has no affected renderable route for host review.", "unsupported-scope");
    const policyDigest = policy(options);
    const candidateDigest = editDigest({ baseDigest: base.digest, project, operation, policyDigest });
    const id = preparation?.id ?? `review-${editDigest({ baseDigest: base.digest, operation, candidateDigest })}`;
    const card: HostReviewCard = { id, workspaceId: base.workspaceId, operation, baseDigest: base.digest, candidateDigest, summary, ownerLabel, affectedUses, routes, status: "open" };
    const body = { ...(preparation ? { preparationDigest: preparation.digest } : {}), schemaVersion: 1 as const, id, host: await realpath(options.composerConfig.workspaceRoot), policyDigest, base, project, card };
    if (fence) await active(fence);
    await (await store()).create({ ...body, integrity: editDigest(body) });
    return structuredClone(card);
  };
  const currentOptions = async (review: Envelope) => {
    await deps.assertSourcesCurrent();
    const options = await deps.options();
    if (policy(options) !== review.policyDigest || !same(options.renderer, review.base.renderer)
      || !same({ ...options.packIdentity, manifestDigest: editDigest(options.pack.manifest) }, review.base.componentPack)) return failure("Host runtime or Content field policy changed; review again.");
    return options;
  };
  /** Runs with Composition snapshot supplied by its writer/read barrier. Never capture here. */
  const checkLocked = async (review: Envelope, state: HostCapture, compositions: { mutationToken: string; records: readonly CompositionRecord[] }) => {
    const options = await currentOptions(review);
    const { registry, content, mappings, sitemaps, assets } = state.stores;
    const contentSnapshot = await content.readAll();
    const mappingSnapshot = await mappings.snapshot(), sitemapSnapshot = await sitemaps.snapshot(), assetSnapshot = await assets.snapshot();
    const workspace = await registry.open(review.base.workspaceId);
    const tokens = { workspace: await registry.generation(), compositions: compositions.mutationToken, content: contentSnapshot.mutationToken, mappings: mappingSnapshot.mutationToken, sitemaps: sitemapSnapshot.mutationToken, assets: assetSnapshot.mutationToken };
    if (!workspace || workspace.status !== "ready" || await registry.selection() !== review.base.workspaceId || !same(tokens, review.base.tokens)) return failure("Workspace changed after host review.");
    const project = projectFromWorkspace(workspace);
    project.providers.compositions[0]!.records = [...compositions.records];
    project.providers.mappings[0]!.records = [...mappingSnapshot.records];
    project.providers.sitemaps[0]!.records = [...sitemapSnapshot.records];
    project.providers.content[0]!.models = [...contentSnapshot.models]; project.providers.content[0]!.entries = [...contentSnapshot.entries];
    if (!same(project, review.base.project) || !same(assetSnapshot, review.base.assets.snapshot) || !same(await capturePublicFiles(options), review.base.publicFiles)) return failure("Reviewed source bytes changed.");
    for (const file of review.base.assets.files) {
      if (!/^uploaded-assets\/sha256-[a-f0-9]{64}\.[a-z0-9]+$/.test(file.fileName)) return failure("Invalid asset capture.", "tampered-plan");
      const handle = await open(join(options.composerConfig.paths.assets, "versions", basename(file.fileName)), constants.O_RDONLY | constants.O_NOFOLLOW);
      try { const bytes = await handle.readFile(); if (bytes.length !== file.byteLength || createHash("sha256").update(bytes).digest("hex") !== file.checksum) return failure("Reviewed asset bytes changed."); } finally { await handle.close(); }
    }
  };
  const acknowledge = (review: Envelope, rendered: HostReviewAcknowledgement) => {
    acknowledgementSchema.parse(rendered);
    const expected = previews.get(`${review.id}/${rendered.identity.pathname}`);
    if (!expected || !same(expected, rendered) || rendered.reviewId !== review.id || rendered.candidateDigest !== review.card.candidateDigest || rendered.baseDigest !== review.base.digest) return failure("Render the exact candidate route before Apply.", "approval-mismatch");
  };
  const receipt = async (review: Envelope) => {
    const operation = review.card.operation;
    if (operation.domain === "content") return (await deps.content(review.card.workspaceId)).service.read({ proposalId: operation.proposalId });
    const root = workspaceDomainRoots(deps.config.paths, review.card.workspaceId).compositions;
    const stat = await lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return failure("Original Composition recovery store is unavailable.", "not-found");
    const compositions = await createFilesystemCompositionStore({ compositionsRoot: root, provideJsx: () => { throw new Error("Receipt recovery never generates source."); } });
    const operationId = `draft-${operation.draftId.slice(6)}-r${operation.revision}`;
    const applied = await compositions.reviewedEditReceipt<DraftReceipt>(operationId);
    const undone = await compositions.reviewedEditReceipt<DraftReceipt>(`undo-${operationId}`);
    for (const value of [applied, undone]) if (value && (value.draftId !== operation.draftId || value.revision !== operation.revision || value.candidateDigest !== operation.draftCandidateDigest || value.workspaceId !== review.card.workspaceId)) return failure("Domain receipt differs from the reviewed operation.", "conflict");
    return { applied, undone };
  };
  const api: HostReviewService = {
    async inspect(input, fence) { return leased(async () => {
      z.object({ workspaceId: name, selection: selectionSchema }).strict().parse(input); await active(fence); await deps.assertSourcesCurrent();
      const options = await deps.options(), snapshot = await captureAuthoringWorkspace(options);
      if (snapshot.workspaceId !== input.workspaceId || snapshot.digest !== input.selection.revision) return failure("Selection is stale; select the current rendered owner again.");
      const compiled = await compileAuthoringWorkspaceSnapshot({ ...options, snapshot });
      const inspected = { ...deps.resolveOwnership({ snapshot, compiled, selection: input.selection, manifest: options.pack.manifest, contentFields: options.composerConfig.assistant?.contentFields ?? [] }), capabilityId: `review-${editDigest({ host: await realpath(deps.config.workspaceRoot), run: runKey(fence), snapshot: snapshot.digest, selection: input.selection })}` };
      await active(fence);
      if (capabilities.size >= 500) capabilities.delete(capabilities.keys().next().value!);
      const body = { id: inspected.capabilityId, host: await realpath(deps.config.workspaceRoot), run: runKey(fence), inspected, snapshot };
      const capability = { ...body, integrity: editDigest(body) };
      await (await capabilityStore()).create(capability);
      capabilities.set(inspected.capabilityId, capability);
      return structuredClone(inspected);
    }); },
    async stageContent(input, fence) { return leased(async () => {
      z.object({ workspaceId: name, capabilityId: ref.shape.reviewId, values: z.record(name, z.string().max(50_000)), summary: z.string().min(1).max(1000) }).strict().parse(input);
      await active(fence);
      const preparation = { id: `review-${editDigest({ host: await realpath(deps.config.workspaceRoot), workspaceId: input.workspaceId, run: runKey(fence), toolCallId: fence.toolCallId })}`, digest: editDigest(input) };
      const previous = await (await store()).read(preparation.id);
      if (previous) { const recovered = await load({ workspaceId: input.workspaceId, reviewId: preparation.id }); if (recovered.preparationDigest !== preparation.digest) return failure("Preparation key was reused for a different edit.", "conflict"); await active(fence); return structuredClone(recovered.card); }
      const capability = capabilities.get(input.capabilityId) ?? await (await capabilityStore()).read(input.capabilityId);
      if (capability) { const { integrity, ...body } = capability; if (integrity !== editDigest(body) || capability.host !== await realpath(deps.config.workspaceRoot)) return failure("Owner inspection changed.", "tampered-plan"); }
      if (!capability || capability.run !== runKey(fence) || capability.snapshot.workspaceId !== input.workspaceId || capability.inspected.owner.domain !== "content") return failure("Inspect this Content owner in the active run first.", "unsupported-target");
      const owner = capability.inspected.owner;
      if (!Object.keys(input.values).length || Object.keys(input.values).some(id => !owner.fieldIds.includes(id))) return failure("Only explicitly inspected Content fields may be staged.", "unsupported-scope");
      const content = await deps.content(input.workspaceId);
      const request: ContentAiStageRequest = { entry: owner.entry, expected: String(capability.snapshot.tokens.content), values: input.values, summary: input.summary, preparationKey: editDigest({ host: await realpath(deps.config.workspaceRoot), workspaceId: input.workspaceId, run: runKey(fence), toolCallId: fence.toolCallId, entry: owner.entry }) };
      // A persisted proposal remains recoverable after a lost response even when
      // current source no longer matches. Apply still checks the original base.
      let result = await content.recover(request, { signal: fence.signal, beforePersist: () => active(fence) });
      if (!result) {
        const assertFresh = async () => {
          await active(fence);
          const options = await deps.options();
          if (!await isAuthoringWorkspaceSnapshotCurrent(options, capability.snapshot)) return failure("Source changed since owner inspection.");
        };
        await assertFresh();
        result = await content.stage(request, { signal: fence.signal, beforePersist: assertFresh });
      }
      if (result.status !== "proposed") return failure(result.message, "unsupported-scope");
      await active(fence);
      const project = structuredClone(capability.snapshot.project);
      const entry = project.providers.content.find(provider => provider.id === owner.entry.providerId)?.entries.find(entry => entry.id === owner.entry.recordId && entry.modelId === owner.entry.modelId);
      if (!entry || result.proposal.expected !== String(capability.snapshot.tokens.content)) return failure("Prepared Content source does not match this review.");
      entry.values = result.proposal.candidate as typeof entry.values;
      const card = await persist(capability.snapshot, project, { domain: "content", proposalId: result.proposal.id, contentCandidateDigest: result.proposal.candidateDigest }, input.summary, `${owner.entry.modelId}/${owner.entry.recordId}`, capability.inspected.affectedUses, preparation, fence);
      await active(fence); return card;
    }); },
    async reviewComposition(input) { return leased(async () => {
      z.object({ workspaceId: name, draftId: name, revision: z.number().int().nonnegative(), candidateDigest: hash }).strict().parse(input);
      await deps.assertSourcesCurrent();
      const view = await deps.drafts.draft({ workspaceId: input.workspaceId }), draft = view.draft;
      if (!draft || draft.status !== "open" || draft.id !== input.draftId || draft.revision !== input.revision || draft.candidateDigest !== input.candidateDigest || draft.stale.length || draft.buildError) return failure("Draft changed; review its exact current revision again.");
      const options = await deps.options(), snapshot = await captureAuthoringWorkspace(options), project = structuredClone(snapshot.project);
      if (snapshot.workspaceId !== input.workspaceId) return failure("Workspace changed.", "wrong-workspace");
      const changed = draft.pages.filter(page => page.changed);
      for (const page of changed) {
        const provider = project.providers.compositions.find(provider => provider.id === page.identity.providerId);
        const index = provider?.records.findIndex(record => record.id === page.identity.recordId) ?? -1;
        if (!provider || index < 0 || !same(provider.records[index], page.before)) return failure("Draft base Composition differs from current capture.");
        provider.records[index] = structuredClone(page.candidate);
      }
      const compiled = await compileAuthoringWorkspaceSnapshot({ ...options, snapshot });
      const uses: AffectedUse[] = compiled.build.routes.flatMap(route => hostDocumentTargets(route).filter(target => changed.some(page => page.identity.providerId === target.providerId && page.identity.recordId === target.recordId)).map(target => ({ pathname: route.pathname, target: { renderedNodeId: target.renderedNodeId, providerId: target.providerId, recordId: target.recordId, nodeId: target.nodeId }, prop: "" })));
      const after = (await deps.drafts.draft({ workspaceId: input.workspaceId })).draft;
      if (!after || after.revision !== draft.revision || after.candidateDigest !== input.candidateDigest) return failure("Draft changed during host review.");
      return persist(snapshot, project, { domain: "composition", draftId: draft.id, revision: draft.revision, draftCandidateDigest: input.candidateDigest }, `${changed.length} Composition owner(s) changed`, changed.map(page => page.identity.recordId).join(", "), uses);
    }); },
    async read(input) {
      const review = await load(input), status = await receipt(review);
      if (status.undone || status.applied) return { ...review.card, status: status.undone ? "undone" : "applied" };
      try {
        const options = await currentOptions(review);
        if (!await isAuthoringWorkspaceSnapshotCurrent(options, review.base)) return { ...review.card, status: "stale", reason: "Workspace changed after this review. Prepare a new review." };
      } catch (error) {
        return { ...review.card, status: "stale", reason: error instanceof Error ? error.message : "Original review runtime is unavailable." };
      }
      return { ...review.card, status: "open" };
    },
    async preview(input) { return leased(async () => {
      ref.extend({ pathname: z.string().startsWith("/").max(2048) }).parse(input);
      const review = await load({ workspaceId: input.workspaceId, reviewId: input.reviewId });
      await currentOptions(review);
      if (!review.card.routes.some(route => route.pathname === input.pathname)) return failure("Select an affected route from this review.", "unsupported-target");
      const build = await compile(review.base, review.project), route = build.routes.find(route => route.pathname === input.pathname)!;
      const identity: HostDocumentIdentity = { workspaceId: review.base.workspaceId, revision: review.card.candidateDigest, pathname: route.pathname, packId: review.project.componentPack.packId, packVersion: review.project.componentPack.packVersion, rendererId: review.base.renderer.id, rendererVersion: review.base.renderer.version, rendererDigest: review.base.renderer.digest };
      const preview = await renderHostDocument(deps.renderer, route, identity, review.project, { url: route.pathname, pathnames: build.routes.map(route => route.pathname) });
      previews.set(`${review.id}/${route.pathname}`, { reviewId: review.id, candidateDigest: review.card.candidateDigest, baseDigest: review.base.digest, identity, frameId: preview.frameId });
      const { html, ...publicPreview } = preview;
      return { reviewId: review.id, candidateDigest: review.card.candidateDigest, baseDigest: review.base.digest, preview: publicPreview, documentUrl: deps.documentCache.put(html, route.pathname) };
    }); },
    async apply(input) { return leased(async () => {
      ref.extend({ rendered: acknowledgementSchema }).parse(input);
      const review = await load({ workspaceId: input.workspaceId, reviewId: input.reviewId }), operation = review.card.operation;
      const prior = await receipt(review);
      if (prior.applied) return { domain: operation.domain, reviewId: review.id, recovered: true, receipt: prior.applied };
      acknowledge(review, input.rendered);
      if (operation.domain === "composition") {
        const value = await deps.drafts.apply({ workspaceId: input.workspaceId, draftId: operation.draftId, revision: operation.revision, approve: operation.draftCandidateDigest }, async guard => {
          if (guard.candidateDigest !== operation.draftCandidateDigest || guard.draftId !== operation.draftId || guard.revision !== operation.revision) return failure("Draft review changed.");
          await checkLocked(review, guard.state, guard.compositions);
        });
        return { domain: "composition", reviewId: review.id, recovered: false, receipt: value };
      }
      const options = await deps.options(), state = await captureHost({ config: options.composerConfig, pack: options.pack });
      const roots = workspaceDomainRoots(options.composerConfig.paths, input.workspaceId);
      const barriers = [join(options.composerConfig.paths.data, "workspaces"), roots.mappings, roots.sitemaps, options.composerConfig.paths.assets];
      const withNextDomainBarrier = async (index: number): Promise<import("../../src/features/assistant/host-review-types").HostReviewOutcome> => index < barriers.length ? withMutationBarrier(barriers[index]!, () => withNextDomainBarrier(index + 1)) : state.stores.compositions.withSnapshotBarrier(async compositions => {
        await checkLocked(review, state as HostCapture, compositions);
        const result = await (await deps.content(input.workspaceId)).service.apply({ proposalId: operation.proposalId, renderedCandidate: operation.contentCandidateDigest });
        return { domain: "content", reviewId: review.id, ...result };
      });
      return withNextDomainBarrier(0);
    }); },
    async undo(input) { return leased(async () => {
      const review = await load(input), operation = review.card.operation;
      const prior = await receipt(review);
      if (prior.undone) return { domain: operation.domain, reviewId: review.id, recovered: true, receipt: prior.undone };
      if (operation.domain === "composition") return { domain: "composition", reviewId: review.id, recovered: false, receipt: await deps.drafts.undo({ workspaceId: input.workspaceId, draftId: operation.draftId, approve: operation.draftCandidateDigest }) };
      return { domain: "content", reviewId: review.id, ...await (await deps.content(input.workspaceId)).service.undo({ proposalId: operation.proposalId }) };
    }); },
  };
  return api;
}
