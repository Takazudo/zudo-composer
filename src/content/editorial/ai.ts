// Bounded Content-AI: a model may propose new Article title and body text,
// and nothing else. Every proposal is validated by the owning backend against
// the precondition it was prepared from, without writing; Apply and Undo go
// through the same keyed save/restore path as a human edit, with the trusted
// `content-ai` source. Publication is never part of it.
import type { ContentEntryRef } from "../model";
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
  operationKey: string;
  provider: string;
}
export type ContentAiPrepareResult = { status: "proposed"; proposal: ContentAiProposal } | { status: "refused"; message: string };

export interface ContentAiServiceOptions {
  /** The owning backend's boundary bound to the given provenance. */
  boundary(provenance: EditorialProvenance): ContentEditorialBoundary;
  actor: { id: string } | null;
  proposer: ContentAiProposer;
  createId(): string;
  /** Prepared proposals kept for Apply; the oldest are dropped past this bound. */
  retain?: number;
  /** Shared proposal memory when the service is rebuilt per request. */
  proposals?: Map<string, ContentAiProposal & { receipt?: EditorialReceipt }>;
  /** False when the host permits proposals but never Apply. */
  canApply?: boolean;
}

export interface ContentAiService {
  scope(entry: ContentEntryRef): Promise<EditorialField[]>;
  prepare(request: { entry: ContentEntryRef; instruction: string; signal?: AbortSignal }): Promise<ContentAiPrepareResult>;
  apply(request: { proposalId: string }): Promise<EditorialReceipt>;
  undo(request: { proposalId: string }): Promise<EditorialReceipt>;
}

export function createContentAiService(options: ContentAiServiceOptions): ContentAiService {
  const ai = options.boundary({ actor: options.actor, source: "content-ai" });
  const proposals = options.proposals ?? new Map<string, ContentAiProposal & { receipt?: EditorialReceipt }>();
  const retain = options.retain ?? 50;

  async function scope(entry: ContentEntryRef): Promise<EditorialField[]> {
    const fields = (await ai.readFields({ entry })).filter((field) => (CONTENT_AI_FIELD_KEYS as readonly string[]).includes(field.key) && CONTENT_AI_KINDS.has(field.kind));
    if (!fields.length) throw new EditorialError("forbidden", "Content-AI edits only an Article's title and body; this Entry has neither.");
    return fields;
  }
  function stored(proposalId: string) {
    const proposal = proposals.get(proposalId);
    if (!proposal) throw new EditorialError("not-found", "This proposal is no longer available; prepare it again.");
    return proposal;
  }

  return {
    scope,
    async prepare(request) {
      const instruction = typeof request.instruction === "string" ? request.instruction.trim() : "";
      if (!instruction || instruction.length > MAX_INSTRUCTION) throw new EditorialError("invalid-request", `Describe the change in 1 to ${MAX_INSTRUCTION} characters.`);
      const fields = await scope(request.entry);
      const pinned = await ai.readEntry({ entry: request.entry, perspective: "working" });
      const output = await options.proposer.propose({
        instruction,
        fields: fields.map((field) => ({ key: field.key, label: field.label, kind: field.kind, value: typeof pinned.values[field.id] === "string" ? pinned.values[field.id] as string : "" })),
        signal: request.signal ?? new AbortController().signal,
      });
      // A model refusal is reported as it is, and nothing is prepared.
      if (output.kind === "refusal") return { status: "refused", message: output.message || "The model declined this change." };
      const values: Record<string, string> = {};
      for (const [key, value] of Object.entries(output.values)) {
        const field = fields.find((candidate) => candidate.key === key);
        if (!field) throw new EditorialError("forbidden", `Content-AI may not write "${key}".`);
        if (typeof value !== "string" || value.length > MAX_VALUE) throw new EditorialError("invalid-value", `The proposed ${field.label} is not usable text.`);
        values[field.id] = value;
      }
      if (!Object.keys(values).length) return { status: "refused", message: "The model proposed no change." };
      // The owning backend validates against the pinned precondition and writes nothing.
      const validation = await ai.validateFields({ entry: request.entry, expected: pinned.expected, values, clear: [] });
      const id = options.createId();
      const proposal: ContentAiProposal = {
        id, entry: request.entry, expected: pinned.expected, summary: output.summary, values,
        differences: validation.differences, candidate: validation.values, operationKey: `content-ai:${id}`, provider: options.proposer.label,
      };
      proposals.set(id, proposal);
      while (proposals.size > retain) proposals.delete(proposals.keys().next().value!);
      return { status: "proposed", proposal: structuredClone(proposal) };
    },
    async apply(request) {
      if (options.canApply === false) throw new EditorialError("forbidden", "This host permits AI proposals but not Apply.");
      const proposal = stored(request.proposalId);
      // The same key on every retry: a lost acknowledgement returns the same receipt.
      const receipt = await ai.saveFields({ entry: proposal.entry, expected: proposal.expected, values: proposal.values, clear: [], operationKey: proposal.operationKey });
      proposal.receipt = receipt;
      return receipt;
    },
    async undo(request) {
      const proposal = stored(request.proposalId);
      if (!proposal.receipt?.revisionId) throw new EditorialError("invalid-request", "This proposal has not been applied.");
      const revision = await ai.readRevision({ entry: proposal.entry, revisionId: proposal.receipt.revisionId });
      if (revision.source !== "content-ai" || revision.operation.key !== proposal.operationKey || !revision.parentId) {
        throw new EditorialError("invalid-request", "Only the revision this proposal applied can be undone.");
      }
      // Pinned to the state right after Apply: any later edit makes Undo refuse rather than overwrite it.
      return ai.restoreRevision({ entry: proposal.entry, revisionId: revision.parentId, expected: proposal.receipt.expected, operationKey: `${proposal.operationKey}:undo` });
    },
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
        if (field.key === "body") values.body = `${field.value}\n\n${instruction}`;
      }
      return { kind: "proposal", values, summary: `Applied the instruction "${instruction}" to ${fields.map((field) => field.label).join(" and ")}.` };
    },
  };
}
