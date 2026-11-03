// The server half of the Content-AI wire, shared by the native dev server and
// any host that answers `createRemoteContentAi` requests. Payloads are parsed
// strictly: a request names an Entry, an instruction or a proposal id and
// nothing else, so actor, source, paths and provider choice stay with the host.
import type { ContentEntryRef } from "../model";
import type { ContentAiService } from "./ai";
import { EditorialError, type EditorialErrorCode, type EditorialFieldDiagnostic } from "./types";

/**
 * Whether inference can run now. `ready` means the provider's own local check
 * passed, not that a model call has succeeded; `unknown` is never reported as
 * signed in.
 */
export type ContentAiInference =
  | { state: "ready"; detail: string; version?: string | null }
  | { state: "unavailable"; code: string; message: string }
  | { state: "unknown"; message: string };

/** `configured` says the host set up Content-AI; `inference` says whether a new proposal can be prepared now. */
export type ContentAiStatus =
  | { configured: false }
  | { configured: true; provider: string; canApply: boolean; inference: ContentAiInference };

export type ContentAiWireOperation = "content-ai-status" | "content-ai-scope" | "content-ai-prepare" | "content-ai-read" | "content-ai-apply" | "content-ai-undo";

export type ContentAiWireResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: EditorialErrorCode; message: string; diagnostics: EditorialFieldDiagnostic[] } };

export interface ContentAiOperationHost {
  status(): Promise<ContentAiStatus>;
  /** Built per request with the host's trusted actor, owner, store, proposer and permission. */
  service(): Promise<ContentAiService>;
}

function shape(payload: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new EditorialError("invalid-request", "Malformed Content-AI request.");
  const value = payload as Record<string, unknown>;
  for (const key of Object.keys(value)) if (!required.includes(key) && !optional.includes(key)) throw new EditorialError("invalid-request", `Content-AI requests do not accept "${key}".`);
  for (const key of required) if (!(key in value)) throw new EditorialError("invalid-request", `Content-AI request is missing "${key}".`);
  return value;
}
function entryOf(value: unknown): ContentEntryRef {
  const entry = shape(value, ["providerId", "modelId", "recordId"]);
  if (![entry.providerId, entry.modelId, entry.recordId].every((part) => typeof part === "string" && part.length > 0 && part.length <= 200)) throw new EditorialError("invalid-request", "Malformed Entry reference.");
  return { providerId: entry.providerId as string, modelId: entry.modelId as string, recordId: entry.recordId as string };
}
const text = (value: unknown, label: string) => {
  if (typeof value !== "string") throw new EditorialError("invalid-request", `Malformed ${label}.`);
  return value;
};

/** One Content-AI request. Editorial refusals become wire errors; anything else is a host fault and is rethrown. */
export async function runContentAiOperation(host: ContentAiOperationHost, operation: string, payload: unknown): Promise<ContentAiWireResult> {
  try {
    if (operation === "content-ai-status") return { ok: true, value: await host.status() };
    switch (operation) {
      case "content-ai-scope": {
        const input = shape(payload, ["entry"]);
        return { ok: true, value: await (await host.service()).scope(entryOf(input.entry)) };
      }
      case "content-ai-prepare": {
        const input = shape(payload, ["entry", "instruction"]);
        return { ok: true, value: await (await host.service()).prepare({ entry: entryOf(input.entry), instruction: text(input.instruction, "instruction") }) };
      }
      case "content-ai-read": {
        const input = shape(payload, ["proposalId"]);
        return { ok: true, value: await (await host.service()).read({ proposalId: text(input.proposalId, "proposal id") }) };
      }
      case "content-ai-apply": {
        const input = shape(payload, ["proposalId"], ["renderedCandidate"]);
        return { ok: true, value: await (await host.service()).apply({ proposalId: text(input.proposalId, "proposal id"), ...(input.renderedCandidate === undefined ? {} : { renderedCandidate: text(input.renderedCandidate, "rendered candidate") }) }) };
      }
      case "content-ai-undo": {
        const input = shape(payload, ["proposalId"]);
        return { ok: true, value: await (await host.service()).undo({ proposalId: text(input.proposalId, "proposal id") }) };
      }
      default: throw new EditorialError("invalid-request", "Unknown Content-AI operation.");
    }
  } catch (error) {
    if (error instanceof EditorialError) return { ok: false, error: { code: error.code, message: error.message, diagnostics: error.diagnostics } };
    throw error;
  }
}
