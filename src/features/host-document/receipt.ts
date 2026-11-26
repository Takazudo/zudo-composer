import { z } from "zod";
import { canonicalStringifyJson } from "../../site-project/model/canonical";
import type { PendingHostEdit } from "./recovery";

const proof = {
  operationId: z.string(),
  planDigest: z.string().regex(/^[a-f0-9]{64}$/),
  workspaceId: z.string(),
  beforeRevision: z.string(),
};
const refused = z.object({ ...proof, outcome: z.literal("document-edit-not-accepted") });
const committed = z.object({ ...proof, recordId: z.string(), before: z.object({ id: z.string() }), after: z.object({ id: z.string() }), committedAt: z.iso.datetime() });

export async function assertHostEditReceipt(request: PendingHostEdit["request"], value: unknown, notAccepted: boolean) {
  const receipt = notAccepted ? refused.parse(value) : committed.parse(value);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalStringifyJson(request)));
  const planDigest = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  if (receipt.planDigest !== planDigest || receipt.operationId !== `host-${request.operationId}` || receipt.workspaceId !== request.workspaceId || receipt.beforeRevision !== request.revision) {
    throw new Error("The receipt does not match this retained operation.");
  }
  if ("recordId" in receipt && (receipt.before.id !== receipt.recordId || receipt.after.id !== receipt.recordId || (request.change.kind !== "reorder-placement" && receipt.recordId !== request.target.recordId))) {
    throw new Error("The receipt does not match the reviewed Composition owner.");
  }
}
