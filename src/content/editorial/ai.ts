// Bounded Content-AI: a model may propose only trusted policy-approved text.
// Omitted policy retains Article title/body compatibility. Every proposal is validated by the owning backend against
// the precondition it was prepared from, without writing; Apply and Undo go
// through the same keyed save/restore path as a human edit, with the trusted
// `content-ai` source. Publication is never part of it.
import type { ContentEntryRef } from "../model";
import { canonicalEditorialJson } from "./differences";
import {
  EditorialError,
  type ContentEditorialBoundary,
  type EditorialField,
  type EditorialFieldDifference,
  type EditorialProvenance,
  type EditorialReceipt,
} from "./types";

/** Field keys and kinds Content-AI may write. Anything else is refused. */
export const CONTENT_AI_FIELD_KEYS = ["title", "body"] as const;
const CONTENT_AI_KINDS = new Set(["text", "long-text", "markdown"]);
const MAX_INSTRUCTION = 2_000;
const MAX_VALUE = 50_000;

export interface ContentAiProposerInput {
  instruction: string;
  /** Only the scoped fields, with their current working values. */
  fields: { key: string; label: string; kind: string; value: string }[];
  signal: AbortSignal;
}
export type ContentAiProposerOutput =
  | { kind: "proposal"; values: Record<string, string>; summary: string }
  | { kind: "refusal"; message: string };
export interface ContentAiProposer {
  readonly label: string;
  propose(input: ContentAiProposerInput): Promise<ContentAiProposerOutput>;
}

export interface ContentAiProposal {
  id: string;
  entry: ContentEntryRef;
  /** The precondition the proposal was validated against; Apply quotes it unchanged. */
  expected: string;
  summary: string;
  /** Field id → proposed value, scoped fields only. */
  values: Record<string, string>;
  differences: EditorialFieldDifference[];
  /** The exact working values Apply would write. */
  candidate: Record<string, unknown>;
  /** SHA-256 of the entry, precondition and candidate: what a rendered preview must acknowledge. */
  candidateDigest: string;
  operationKey: string;
  provider: string;
  createdAt: string;
  /** After this a fresh Apply is refused; a committed Apply or Undo stays recoverable. */
  expiresAt: string;
}
export type ContentAiPrepareResult = { status: "proposed"; proposal: ContentAiProposal } | { status: "refused"; message: string };

/**
 * The immutable record of one prepared proposal. It is persisted before the
 * proposal is acknowledged, holds no editable Content, and is never updated:
 * whether it was applied or undone is read back from the owning backend's
 * receipts, so a crash between a commit and its response loses nothing.
 */
export interface ContentAiProposalRecord {
  schemaVersion: 1;
  /** The trusted backend scope (store or site) the proposal belongs to; never taken from a request. */
  owner: string;
  actorId: string | null;
  proposal: ContentAiProposal;
  /** Internal deterministic staging replay fingerprint; absent for ordinary proposals. */
  preparation?: { keyDigest: string; payloadDigest: string };
}
export interface ContentAiProposalStore {
  /** Create-only: an existing id is never overwritten. */
  create(record: ContentAiProposalRecord): Promise<void>;
  read(id: string): Promise<ContentAiProposalRecord | null>;
}

/** A proposal with what the backend has committed for it. */
export interface ContentAiOperation {
  proposal: ContentAiProposal;
  applied: EditorialReceipt | null;
  undone: EditorialReceipt | null;
}
export interface ContentAiOutcome { receipt: EditorialReceipt; recovered: boolean }

export interface ContentAiFieldPolicy { providerId: string; modelId: string; fieldIds: readonly string[] }

export interface ContentAiServiceOptions {
  /** Trusted policy; absent keeps title/body defaults, empty denies all fields. */
  contentFields?: readonly ContentAiFieldPolicy[];
  /** The owning backend's boundary bound to the given provenance. */
  boundary(provenance: EditorialProvenance): ContentEditorialBoundary;
  actor: { id: string } | null;
  /** Trusted backend scope; a proposal recorded under another owner or actor is not found. */
  owner: string;
  /**
   * The inference provider, or null while none is usable. Reads, recovery of
   * committed operations, Apply of an already prepared proposal and Undo
   * never call it, so they keep working without one.
   */
  proposer: ContentAiProposer | null;
  store: ContentAiProposalStore;
  createId(): string;
  now?(): Date;
  /** How long a prepared proposal may be freshly applied; default 24 hours. */
  ttlMs?: number;
  /** False when the host permits proposals but no fresh Apply or Undo; committed ones stay recoverable. */
  canApply?: boolean;
}

export interface ContentAiService {
  scope(entry: ContentEntryRef): Promise<EditorialField[]>;
  prepare(request: { entry: ContentEntryRef; instruction: string; signal?: AbortSignal }): Promise<ContentAiPrepareResult>;
  /** The proposal and its committed Apply/Undo receipts; never writes and never calls the model. */
  read(request: { proposalId: string }): Promise<ContentAiOperation>;
  /**
   * Recovers the committed Apply when there is one. Otherwise a fresh Apply
   * needs `renderedCandidate` to equal the proposal's candidate digest.
   */
  apply(request: { proposalId: string; renderedCandidate?: string }): Promise<ContentAiOutcome>;
  undo(request: { proposalId: string }): Promise<ContentAiOutcome>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PROPOSAL_ID = /^[A-Za-z0-9-]{8,80}$/;

export async function contentAiCandidateDigest(value: { entry: ContentEntryRef; expected: string; candidate: Record<string, unknown> }): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalEditorialJson({ entry: value.entry, expected: value.expected, candidate: value.candidate as never }));
  return [...new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function contentAiScope(options: ContentAiServiceOptions, ai: ContentEditorialBoundary, entry: ContentEntryRef): Promise<EditorialField[]> {
  const policy = options.contentFields?.find(item => item.providerId === entry.providerId && item.modelId === entry.modelId);
  const fields = (await ai.readFields({ entry })).filter(field => CONTENT_AI_KINDS.has(field.kind) && (options.contentFields === undefined
    ? (CONTENT_AI_FIELD_KEYS as readonly string[]).includes(field.key) : policy?.fieldIds.includes(field.id)));
  if (!fields.length) throw new EditorialError("forbidden", "No editable text fields are permitted by this host's Content-AI policy.");
  return fields;
}

export interface ContentAiStageRequest {
  entry: ContentEntryRef; expected: string; values: Record<string, string>; summary: string; preparationKey: string;
}
export interface ContentAiStageGuard { signal?: AbortSignal; beforePersist?(): Promise<void> }

/** Internal trusted staging API. Never dispatched by the Content browser wire. No inference call. */
export function createContentAiStager(options: ContentAiServiceOptions & { providerLabel: string }) {
  return { stage: (request: ContentAiStageRequest, guard: ContentAiStageGuard = {}): Promise<ContentAiPrepareResult> =>
    stageValidatedContentAi(options, request, options.providerLabel, guard) };
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalEditorialJson(value as never));
  return [...new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function stageValidatedContentAi(options: ContentAiServiceOptions, raw: Omit<ContentAiStageRequest, "preparationKey"> & { preparationKey?: string }, provider: string, guard: ContentAiStageGuard): Promise<ContentAiPrepareResult> {
  const request = structuredClone(raw);
  guard.signal?.throwIfAborted();
  if (typeof request.summary !== "string" || request.summary.length > 1000 || !request.values || typeof request.values !== "object" || Array.isArray(request.values) || Object.keys(request.values).length > 100) throw new EditorialError("invalid-request", "Malformed bounded Content proposal.");
  if (request.preparationKey !== undefined && (typeof request.preparationKey !== "string" || !request.preparationKey.trim() || request.preparationKey.length > 512)) throw new EditorialError("invalid-request", "Malformed proposal preparation key.");
  const keyDigest = request.preparationKey === undefined ? undefined : await sha256({ owner: options.owner, actorId: options.actor?.id ?? null, key: request.preparationKey });
  const payloadDigest = await sha256({ entry: request.entry, expected: request.expected, values: request.values, summary: request.summary, provider });
  const id = keyDigest ? `stage-${keyDigest}` : options.createId();
  const replay = async (): Promise<ContentAiPrepareResult | null> => {
    if (!keyDigest) return null;
    const record = await options.store.read(id);
    if (!record) return null;
    if (record.owner !== options.owner || record.actorId !== (options.actor?.id ?? null) || record.proposal.id !== id || record.preparation?.keyDigest !== keyDigest || record.preparation.payloadDigest !== payloadDigest) throw new EditorialError("operation-key-reuse", "This preparation key belongs to another proposal.");
    guard.signal?.throwIfAborted();
    await guard.beforePersist?.();
    guard.signal?.throwIfAborted();
    return { status: "proposed", proposal: structuredClone(record.proposal) };
  };
  const prior = await replay();
  if (prior) return prior;
  const ai = options.boundary({ actor: options.actor, source: "content-ai" });
  const fields = await contentAiScope(options, ai, request.entry);
  for (const [id, value] of Object.entries(request.values)) {
    const field = fields.find(field => field.id === id);
    if (!field) throw new EditorialError("forbidden", `Content-AI may not write "${id}".`);
    if (typeof value !== "string" || value.length > MAX_VALUE) throw new EditorialError("invalid-value", `The proposed ${field.label} is not usable text.`);
  }
  if (!Object.keys(request.values).length) return { status: "refused", message: "The model proposed no change." };
  const validation = await ai.validateFields({ entry: request.entry, expected: request.expected, values: request.values, clear: [] });
  if (!validation.differences.length) return { status: "refused", message: "The proposal matches the saved values; there is nothing to apply." };
  const createdAt = options.now?.() ?? new Date();
  const proposal: ContentAiProposal = {
    id, entry: request.entry, expected: request.expected, summary: request.summary, values: request.values,
    differences: validation.differences, candidate: validation.values,
    candidateDigest: await contentAiCandidateDigest({ entry: request.entry, expected: request.expected, candidate: validation.values }),
    operationKey: `content-ai:${id}`, provider, createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + (options.ttlMs ?? DAY_MS)).toISOString(),
  };
  guard.signal?.throwIfAborted();
  await guard.beforePersist?.();
  guard.signal?.throwIfAborted();
  try {
    await options.store.create({ schemaVersion: 1, owner: options.owner, actorId: options.actor?.id ?? null, proposal, ...(keyDigest ? { preparation: { keyDigest, payloadDigest } } : {}) });
  } catch (error) {
    const recovered = await replay();
    if (recovered) return recovered;
    throw error;
  }
  // A late abort may leave a private recoverable proposal, never a canonical Content mutation.
  guard.signal?.throwIfAborted();
  return { status: "proposed", proposal: structuredClone(proposal) };
}

export function createContentAiService(options: ContentAiServiceOptions): ContentAiService {
  const ai = options.boundary({ actor: options.actor, source: "content-ai" });
  const now = () => options.now?.() ?? new Date();

  async function scope(entry: ContentEntryRef): Promise<EditorialField[]> {
    return contentAiScope(options, ai, entry);
  }
  async function stored(proposalId: unknown): Promise<ContentAiProposal> {
    if (typeof proposalId !== "string" || !PROPOSAL_ID.test(proposalId)) throw new EditorialError("invalid-request", "Malformed proposal id.");
    const record = await options.store.read(proposalId);
    // Another backend's or actor's proposal answers exactly like a missing one.
    if (!record || record.owner !== options.owner || record.actorId !== (options.actor?.id ?? null) || record.proposal.id !== proposalId) {
      throw new EditorialError("not-found", "This proposal is not available here; prepare it again.");
    }
    return record.proposal;
  }
  const undoKey = (proposal: ContentAiProposal) => `${proposal.operationKey}:undo`;

  return {
    scope,
    async prepare(request) {
      const instruction = typeof request.instruction === "string" ? request.instruction.trim() : "";
      if (!instruction || instruction.length > MAX_INSTRUCTION) throw new EditorialError("invalid-request", `Describe the change in 1 to ${MAX_INSTRUCTION} characters.`);
      const proposer = options.proposer;
      if (!proposer) throw new EditorialError("unavailable", "No AI provider is available on this host. Saved Content, history and committed AI operations stay readable.");
      request.signal?.throwIfAborted();
      const fields = await scope(request.entry);
      const pinned = await ai.readEntry({ entry: request.entry, perspective: "working" });
      const output = await proposer.propose({
        instruction,
        fields: fields.map((field) => ({ key: field.key, label: field.label, kind: field.kind, value: typeof pinned.values[field.id] === "string" ? pinned.values[field.id] as string : "" })),
        signal: request.signal ?? new AbortController().signal,
      });
      request.signal?.throwIfAborted();
      // A model refusal is reported as it is, and nothing is prepared.
      if (output.kind === "refusal") return { status: "refused", message: output.message || "The model declined this change." };
      const values: Record<string, string> = {};
      for (const [key, value] of Object.entries(output.values)) {
        const field = fields.find((candidate) => candidate.key === key);
        if (!field) throw new EditorialError("forbidden", `Content-AI may not write "${key}".`);
        if (typeof value !== "string" || value.length > MAX_VALUE) throw new EditorialError("invalid-value", `The proposed ${field.label} is not usable text.`);
        values[field.id] = value;
      }
      return stageValidatedContentAi(options, { entry: request.entry, expected: pinned.expected, values, summary: output.summary }, proposer.label, { signal: request.signal });
    },
    async read(request) {
      const proposal = await stored(request.proposalId);
      const applied = await ai.readOperation({ entry: proposal.entry, operationKey: proposal.operationKey });
      const undone = applied ? await ai.readOperation({ entry: proposal.entry, operationKey: undoKey(proposal) }) : null;
      return structuredClone({ proposal, applied, undone });
    },
    async apply(request) {
      const proposal = await stored(request.proposalId);
      // Recovery first: an Apply that committed is found by its key, whatever came after it.
      const committed = await ai.readOperation({ entry: proposal.entry, operationKey: proposal.operationKey });
      if (committed) return { receipt: committed, recovered: true };
      if (options.canApply === false) throw new EditorialError("forbidden", "This host permits AI proposals but not Apply.");
      if (now().getTime() > Date.parse(proposal.expiresAt)) throw new EditorialError("invalid-request", "This proposal expired before it was applied; prepare it again.");
      if (request.renderedCandidate !== proposal.candidateDigest) throw new EditorialError("invalid-request", "Apply needs a successful render of this exact candidate first.");
      const fields = await scope(proposal.entry);
      for (const id of Object.keys(proposal.values)) if (!fields.some(field => field.id === id)) throw new EditorialError("forbidden", "This proposal includes a field no longer permitted by the host policy.");
      // The immutable payload and key on every attempt; a stale precondition refuses and writes nothing.
      const receipt = await ai.saveFields({ entry: proposal.entry, expected: proposal.expected, values: proposal.values, clear: [], operationKey: proposal.operationKey });
      return { receipt, recovered: false };
    },
    async undo(request) {
      const proposal = await stored(request.proposalId);
      const applied = await ai.readOperation({ entry: proposal.entry, operationKey: proposal.operationKey });
      if (!applied?.revisionId) throw new EditorialError("invalid-request", "This proposal has not been applied.");
      const committed = await ai.readOperation({ entry: proposal.entry, operationKey: undoKey(proposal) });
      if (committed) return { receipt: committed, recovered: true };
      if (options.canApply === false) throw new EditorialError("forbidden", "This host permits AI proposals but not Undo.");
      const revision = await ai.readRevision({ entry: proposal.entry, revisionId: applied.revisionId });
      if (revision.source !== "content-ai" || revision.operation.key !== proposal.operationKey || !revision.parentId) {
        throw new EditorialError("invalid-request", "Only the revision this proposal applied can be undone.");
      }
      // Pinned to the state right after Apply: any later edit makes Undo refuse rather than overwrite it.
      const receipt = await ai.restoreRevision({ entry: proposal.entry, revisionId: revision.parentId, expected: applied.expected, operationKey: undoKey(proposal) });
      return { receipt, recovered: false };
    },
  };
}

/** A process-local proposal store for tests and hosts that opt out of durability. */
export function createMemoryContentAiProposalStore(records = new Map<string, ContentAiProposalRecord>()): ContentAiProposalStore {
  return {
    async create(record) {
      if (records.has(record.proposal.id)) throw new EditorialError("operation-key-reuse", "A proposal with this id already exists.");
      records.set(record.proposal.id, structuredClone(record));
    },
    async read(id) { const record = records.get(id); return record ? structuredClone(record) : null; },
  };
}

/**
 * Offline deterministic proposer for local trials and tests. It never contacts
 * a model, and its output is not evidence of model behavior.
 */
export function createFakeContentAiProposer(): ContentAiProposer {
  return {
    label: "Fake provider (offline, deterministic)",
    async propose({ instruction, fields }) {
      if (/\brefuse\b/i.test(instruction)) return { kind: "refusal", message: "The fake provider declines instructions that ask it to refuse." };
      const values: Record<string, string> = {};
      for (const field of fields) {
        if (field.key === "title") values.title = `${field.value} — ${instruction}`.slice(0, 200);
        else if (field.key === "body") values.body = `${field.value}\n\n## Revision note\n\n${instruction}`;
        else values[field.key] = `${field.value} — ${instruction}`.slice(0, MAX_VALUE);
      }
      return { kind: "proposal", values, summary: `Applied the instruction "${instruction}" to ${fields.map((field) => field.label).join(" and ")}.`.slice(0, 1000) };
    },
  };
}
