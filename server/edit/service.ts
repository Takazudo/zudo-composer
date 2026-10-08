import { createHash, randomUUID } from "node:crypto";
import { realpath, readFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { JsonValue } from "@zudo-composer/component-contract";
import { loadHostContext } from "../host-context.mjs";
import { captureHost, resolvePage, type CaptureHostOptions, type HostCapture } from "./inspect";
import { EditError, openPlans } from "./plans";
import { acquireAuthoringLease } from "./authoring-lease.mjs";
import { canonicalStringifyJson } from "../../src/site-project/model/canonical";
import { indexDocument } from "../../src/composer/model/index-model";
import { addNode, updateProps } from "../../src/composer/model/commands";
import { planLinkedJsxModules } from "../../src/composer/source/plan-linked-jsx";
import type { CompositionRecord } from "../../src/composer/library/types";
import type { JsonObject } from "../../src/composer/model/types";
import { resolveLocalReleaseToolchain } from "../site-project-local/toolchain-config";
import { workspaceDomainRoots } from "../../src/shared/workspace-scope";
import { withMutationBarrier } from "../../src/shared/node-fs";
import type { AssetVersionPin } from "../../src/assets/model/types";

const name = z.string().min(1).max(256);
const pageSchema = z.object({ workspaceId: name, page: name, sitemapId: name.optional() }).strict();
const afterSchema = z.union([
  z.object({ nodeId: name }).strict(),
  z.object({ kind: z.enum(["paragraph", "list", "image", "table"]), ordinal: z.number().int().positive() }).strict(),
]);
const insertSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string().min(1).max(100_000) }).strict(),
  z.object({ kind: z.literal("image"), assetId: name, alt: z.string().max(10_000) }).strict(),
  z.object({ kind: z.literal("table"), columns: z.array(z.string()).min(1).max(100), rows: z.array(z.array(z.string())).min(1).max(1000) }).strict(),
]);
export const editRequestSchema = pageSchema.extend({ after: afterSchema, insert: insertSchema }).strict();
export type EditRequest = z.infer<typeof editRequestSchema>;
const idSchema = z.object({ planId: name }).strict();
const approvalSchema = idSchema.extend({ approve: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type EditPlan = {
  schemaVersion: 1; policy: "native-page-insertion-v1"; id: string; createdAt: string;
  host: string; request: EditRequest; identity: ReturnType<typeof resolvePage>["identity"];
  generatedId: string; before: CompositionRecord; candidate: CompositionRecord; jsx: string;
  revisions: unknown; assetPin: AssetVersionPin | null; digest: string;
};
export interface EditReceipt {
  schemaVersion: 1; operationId: string; planId: string; reviewDigest: string;
  kind: "applied" | "undone"; identity: EditPlan["identity"];
  beforeDigest: string; afterDigest: string; jsxDigest: string; committedAt: string;
}
export const editDigest = (value: unknown): string => createHash("sha256").update(canonicalStringifyJson(value as JsonValue)).digest("hex");
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new EditError("invalid-request", result.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  return result.data;
}
function assertWritable(page: ReturnType<typeof resolvePage>) {
  if (page.writeBlockers.length) throw new EditError("unsupported-scope", page.writeBlockers.join(" "));
}
function planDigest(plan: Omit<EditPlan, "digest"> | EditPlan): string {
  const reviewed = { ...plan } as Partial<EditPlan>;
  delete reviewed.digest;
  return editDigest(reviewed);
}
function checkPlan(plan: EditPlan, host: string) {
  if (plan.schemaVersion !== 1 || plan.policy !== "native-page-insertion-v1" || plan.host !== host) throw new EditError("wrong-host", "Plan belongs to another host or policy.");
  parse(editRequestSchema, plan.request);
  if (planDigest(plan) !== plan.digest) throw new EditError("tampered-plan", "Stored reviewed plan has changed. Create a new plan.");
}
function candidate(capture: HostCapture, request: EditRequest, generatedId: string, timestamp: string, assetPin: AssetVersionPin | null) {
  const page = resolvePage(capture, request);
  assertWritable(page);
  const matching = page.targets.filter(target => "nodeId" in request.after
    ? target.nodeId === request.after.nodeId
    : target.kind === request.after.kind && target.ordinal === request.after.ordinal);
  if (matching.length !== 1) throw new EditError("unsupported-target", "Select exactly one standalone native node from inspect.targets. Markdown sub-blocks, opaque components, and guessed positions are unsupported.");
  const anchor = indexDocument(page.record.document, capture.manifest).byId.get(matching[0]!.nodeId)!;
  const insert = request.insert;
  const kind = insert.kind === "text" ? "paragraph" : insert.kind;
  const capability = page.capabilities[kind];
  if (!capability?.available) throw new EditError("unsupported-capability", capability?.reason ?? `Host has no ${kind} insertion capability.`);
  const config = capture.config.nativeEditing!;
  let props: JsonObject;
  if (insert.kind === "text") props = { [config.paragraph!.textProp]: insert.text };
  else if (insert.kind === "image") {
    if (!assetPin) throw new EditError("invalid-asset", "An exact managed image pin is required.");
    props = { [config.image!.srcProp]: assetPin.url, [config.image!.altProp]: insert.alt };
  } else {
    if (insert.rows.some(row => row.length !== insert.columns.length)) throw new EditError("invalid-table", "Every supplied row must have exactly one cell per supplied column.");
    props = { [config.table!.columnsProp]: insert.columns, [config.table!.rowsProp]: insert.rows };
  }
  const component = capture.manifest.get(capability.componentId)!;
  // Extra defaults could introduce a caption/heading the request did not authorize.
  if (Object.keys(component.defaults ?? {}).some(prop => !Object.hasOwn(props, prop)) || component.slots.length) throw new EditError("unsupported-capability", "Native insertion components must be leaf nodes with only the declared supplied props; extra defaults or structural wrappers are unsupported.");
  const added = addNode(page.record.document, capture.manifest, { parentId: anchor.parentId, slotId: anchor.slotId, index: anchor.index + 1 }, capability.componentId, () => generatedId, page.rootPolicy);
  if (!added.ok) throw new EditError("component-invalid", added.error);
  const updated = updateProps(added.document, capture.manifest, generatedId, props);
  if (!updated.ok) throw new EditError("component-invalid", updated.error);
  const result: CompositionRecord = { ...page.record, updatedAt: timestamp, document: updated.document };
  const records = capture.records.compositions.map(record => record.id === result.id ? result : record);
  const output = planLinkedJsxModules({ manifest: capture.manifest, records, sourceOutcomes: new Map(records.map(record => [record.id, { status: "loaded" as const, record }])), moduleSpecifier: id => `./composition-${id}.tsx` }).byRecordId.get(result.id);
  if (!output || output.status !== "generated") throw new EditError("component-invalid", "Candidate cannot generate valid production JSX under the real component grammar.");
  // Check the precise effect independently: remove the one generated node and compare.
  const reverted = structuredClone(result.document);
  const located = indexDocument(reverted, capture.manifest).byId.get(generatedId)!;
  const siblings = located.parentId === null ? reverted.root : indexDocument(reverted, capture.manifest).byId.get(located.parentId)!.node.slots[located.slotId]!;
  siblings.splice(located.index, 1);
  if (editDigest(reverted) !== editDigest(page.record.document)) throw new EditError("effect-invalid", "Candidate changes more than the requested insertion.");
  return { page, record: result, jsx: output.code };
}

/** Shared deterministic service. Callers supply approval separately from proposals.
 * The digest binds content; the caller, not this service, supplies human authority.
 */
export function createEditingService(options: CaptureHostOptions) {
  const capture = async () => {
    // A service can outlive a host module edit. Re-evaluate trusted inputs rather
    // than attesting fresh source bytes alongside a stale in-memory manifest.
    const fresh = await loadHostContext({ workspaceRoot: options.config.workspaceRoot });
    if (editDigest(fresh.composerConfig.paths) !== editDigest(options.config.paths)) throw new EditError("stale-config", "Storage paths changed; reopen the editing service before continuing.");
    return captureHost({ config: fresh.composerConfig, pack: fresh.pack, packIdentity: fresh.packIdentity });
  };
  const identity = () => realpath(options.config.workspaceRoot);
  const sourceBytes = async (path: string) => {
    try {
      const stat = await lstat(path);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new EditError("unsupported-source", "Host source/config must be regular files.");
      return createHash("sha256").update(await readFile(path)).digest("hex");
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  };
  const revisions = async (state: HostCapture) => ({
    hostSources: await Promise.all([options.config.configPath, join(options.config.workspaceRoot, "site-project.ts"), join(options.config.workspaceRoot, "site-project.json")].map(sourceBytes)),
    tokens: state.tokens, workspace: state.workspace, sourceAuthored: state.sourceAuthored,
    config: state.config.nativeEditing ?? null,
    toolchain: await resolveLocalReleaseToolchain({ pack: state.pack, packIdentity: state.packIdentity, workspaceRoot: state.config.workspaceRoot, stylesPath: state.config.paths.styles }),
  });
  const leased = async <T>(action: () => Promise<T>) => {
    const lease = await acquireAuthoringLease(options.config.workspaceRoot, "reviewed-edit");
    try { return await action(); } finally { await lease.release(); }
  };
  const pin = async (state: HostCapture, request: EditRequest): Promise<AssetVersionPin | null> => {
    if (request.insert.kind !== "image") return null;
    const assetId = request.insert.assetId;
    const asset = state.assets.records.find(record => record.id === assetId);
    if (!asset || asset.document.state !== "active") throw new EditError("invalid-asset", "Select an active managed image from this host.");
    const value = await state.stores.assets.resolveVersion({ providerId: "asset-files", assetId, versionId: asset.document.currentVersionId });
    if (!value.mimeType.startsWith("image/")) throw new EditError("invalid-asset", "The supplied asset is not an image.");
    return value;
  };
  const loadPlan = async (id: string) => {
    const plans = await openPlans(options.config.paths.data);
    const plan = await plans.read<EditPlan>(id);
    checkPlan(plan, await identity());
    if (plan.id !== id) throw new EditError("tampered-plan", "Plan identity differs from its storage key.");
    return { plans, plan };
  };
  const pending = async (id: string, plans: Awaited<ReturnType<typeof openPlans>>) => {
    if (await plans.status(id) !== "pending") throw new EditError("inactive-plan", "Plan was discarded or superseded. Create and review a new plan.");
  };
  const barriers = async <T>(state: HostCapture, action: () => Promise<T>): Promise<T> => {
    const roots = workspaceDomainRoots(options.config.paths, state.workspaceId);
    const all = [join(options.config.paths.data, "workspaces"), roots.content, roots.mappings, roots.sitemaps, options.config.paths.assets];
    const next = (index: number): Promise<T> => index === all.length ? action() : withMutationBarrier(all[index]!, () => next(index + 1));
    return next(0);
  };
  return {
    async inspect(input: unknown) { const request = parse(pageSchema, input); return resolvePage(await capture(), request); },
    async resolve(input: unknown) {
      const request = parse(pageSchema.extend({ after: afterSchema }).strict(), input);
      const page = resolvePage(await capture(), request);
      const targets = page.targets.filter(target => "nodeId" in request.after ? target.nodeId === request.after.nodeId : target.kind === request.after.kind && target.ordinal === request.after.ordinal);
      if (targets.length !== 1) throw new EditError("unsupported-target", "Select one standalone native target from inspect.targets.");
      return { identity: page.identity, target: targets[0], writeBlockers: page.writeBlockers };
    },
    async plan(input: unknown): Promise<EditPlan> {
      const request = parse(editRequestSchema, input);
      return leased(async () => {
        const state = await capture();
        const assetPin = await pin(state, request);
        const id = `plan-${randomUUID()}`, generatedId = `edit-${randomUUID()}`, createdAt = new Date().toISOString();
        const built = candidate(state, request, generatedId, createdAt, assetPin);
        const plan: EditPlan = { schemaVersion: 1, policy: "native-page-insertion-v1", id, createdAt, host: await identity(), request, identity: built.page.identity, generatedId, before: built.page.record, candidate: built.record, jsx: built.jsx, revisions: await revisions(state), assetPin, digest: "" };
        plan.digest = planDigest(plan);
        await (await openPlans(options.config.paths.data)).create(id, plan);
        return structuredClone(plan);
      });
    },
    async review(input: unknown) { return (await loadPlan(parse(idSchema, input).planId)).plan; },
    async apply(input: unknown): Promise<EditReceipt> {
      const { planId, approve } = parse(approvalSchema, input);
      return leased(async () => {
        const { plans, plan } = await loadPlan(planId);
        if (approve !== plan.digest) throw new EditError("approval-mismatch", "Approval must quote the exact reviewed digest.");
        await pending(planId, plans);
        const initial = await capture();
        if (initial.workspaceId !== plan.identity.workspaceId) throw new EditError("wrong-workspace", "The selected workspace changed; restore the reviewed workspace or create a new plan.");
        const existing = await initial.stores.compositions.reviewedEditReceipt<EditReceipt>(planId);
        if (existing) { if (existing.reviewDigest !== approve) throw new EditError("conflict", "Receipt belongs to another review."); return existing; }
        return barriers(initial, async () => {
          const state = await capture();
          if (editDigest(await revisions(state)) !== editDigest(plan.revisions)) throw new EditError("stale-plan", "Reviewed dependencies changed. Create a fresh plan and review; approval cannot be rebased.");
          const assetPin = await pin(state, plan.request);
          if (editDigest(assetPin) !== editDigest(plan.assetPin)) throw new EditError("stale-asset", "Reviewed asset changed.");
          const rebuilt = candidate(state, plan.request, plan.generatedId, plan.createdAt, assetPin);
          if (editDigest(rebuilt.page.record) !== editDigest(plan.before) || editDigest(rebuilt.page.identity) !== editDigest(plan.identity) || editDigest(rebuilt.record) !== editDigest(plan.candidate) || rebuilt.jsx !== plan.jsx) throw new EditError("tampered-plan", "Candidate does not equal the one exact requested insertion.");
          const receipt: EditReceipt = { schemaVersion: 1, operationId: planId, planId, reviewDigest: plan.digest, kind: "applied", identity: plan.identity, beforeDigest: editDigest(plan.before), afterDigest: editDigest(plan.candidate), jsxDigest: editDigest(plan.jsx), committedAt: new Date().toISOString() };
          return state.stores.compositions.commitReviewedEdit({ operationId: planId, planDigest: plan.digest, expectedSnapshotToken: state.tokens.compositions, candidate: plan.candidate, jsx: plan.jsx, receipt }, async () => {
            // Catalog/source bytes can change independently of CMS writers.
            if (editDigest(await revisions(state)) !== editDigest(plan.revisions)) throw new EditError("stale-plan", "Pack or source changed at the writer boundary.");
          });
        });
      });
    },
    async receipt(input: unknown) {
      const { planId } = parse(idSchema, input);
      const { plan } = await loadPlan(planId);
      const state = await capture();
      if (state.workspaceId !== plan.identity.workspaceId) throw new EditError("wrong-workspace", "Select the plan's workspace.");
      return { applied: await state.stores.compositions.reviewedEditReceipt<EditReceipt>(planId) ?? null, undone: await state.stores.compositions.reviewedEditReceipt<EditReceipt>(`undo-${planId}`) ?? null };
    },
    async discard(input: unknown) {
      const { planId } = parse(idSchema, input);
      return leased(async () => {
        const { plans, plan } = await loadPlan(planId);
        const state = await capture();
        if (state.workspaceId !== plan.identity.workspaceId) throw new EditError("wrong-workspace", "Select the plan’s workspace before discard.");
        if (await state.stores.compositions.reviewedEditReceipt(planId)) throw new EditError("already-applied", "An applied plan must use guarded undo.");
        await plans.disposition(planId, "discarded"); return { planId, status: "discarded" };
      });
    },
    async supersede(input: unknown) {
      const { planId, replacementPlanId } = parse(idSchema.extend({ replacementPlanId: name }).strict(), input);
      return leased(async () => {
        if (planId === replacementPlanId) throw new EditError("invalid-request", "A plan cannot supersede itself.");
        const old = await loadPlan(planId), replacement = await loadPlan(replacementPlanId);
        await pending(replacementPlanId, replacement.plans);
        if (editDigest(old.plan.identity) !== editDigest(replacement.plan.identity)) throw new EditError("wrong-target", "Replacement must address the same owner-qualified page.");
        const state = await capture();
        if (state.workspaceId !== old.plan.identity.workspaceId) throw new EditError("wrong-workspace", "Select the plan’s workspace before supersession.");
        if (await state.stores.compositions.reviewedEditReceipt(planId)) throw new EditError("already-applied", "An applied plan cannot be superseded.");
        await old.plans.disposition(planId, "superseded", replacementPlanId); return { planId, status: "superseded", replacementPlanId };
      });
    },
    async undo(input: unknown): Promise<EditReceipt> {
      const { planId, approve } = parse(approvalSchema, input);
      return leased(async () => {
        const { plan } = await loadPlan(planId);
        if (approve !== plan.digest) throw new EditError("approval-mismatch", "Quote the original review digest for guarded undo.");
        const initial = await capture();
        return barriers(initial, async () => {
          const state = await capture();
          const applied = await state.stores.compositions.reviewedEditReceipt<EditReceipt>(planId);
          if (!applied) throw new EditError("not-applied", "No committed receipt exists for this plan.");
          if (applied.reviewDigest !== plan.digest || editDigest(applied.identity) !== editDigest(plan.identity) || applied.beforeDigest !== editDigest(plan.before) || applied.afterDigest !== editDigest(plan.candidate)) throw new EditError("tampered-plan", "Plan and durable receipt disagree; undo refused.");
          const operationId = `undo-${planId}`;
          const existing = await state.stores.compositions.reviewedEditReceipt<EditReceipt>(operationId);
          if (existing) return existing;
          const page = resolvePage(state, plan.request); assertWritable(page);
          if (editDigest(page.identity) !== editDigest(plan.identity)) throw new EditError("wrong-target", "The page owner changed.");
          if (editDigest(page.record) !== applied.afterDigest) throw new EditError("undo-conflict", "A subsequent edit changed the draft. Undo will not overwrite it.");
          // Removing only our insertion preserves exact prior canonical content.
          const priorRecords = state.records.compositions.map(record => record.id === plan.before.id ? plan.before : record);
          const output = planLinkedJsxModules({ manifest: state.manifest, records: priorRecords, sourceOutcomes: new Map(priorRecords.map(record => [record.id, { status: "loaded" as const, record }])), moduleSpecifier: id => `./composition-${id}.tsx` }).byRecordId.get(plan.before.id);
          if (!output || output.status !== "generated") throw new EditError("undo-conflict", "Current pack/template cannot safely render the prior draft.");
          const undoRevisions = await revisions(state);
          const receipt: EditReceipt = { ...applied, operationId, kind: "undone", beforeDigest: applied.afterDigest, afterDigest: applied.beforeDigest, jsxDigest: editDigest(output.code), committedAt: new Date().toISOString() };
          return state.stores.compositions.commitReviewedEdit({ operationId, planDigest: approve, expectedSnapshotToken: state.tokens.compositions, candidate: plan.before, jsx: output.code, receipt }, async () => {
            if (editDigest(await revisions(state)) !== editDigest(undoRevisions)) throw new EditError("undo-conflict", "Pack or source changed at the undo writer boundary.");
          });
        });
      });
    },
  };
}
