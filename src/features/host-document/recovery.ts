import { z } from "zod";
import type { HostDocumentIdentity } from "../../../server/host-document/types";

const name = z.string().min(1).max(256);
const identity = z.object({ workspaceId: name, revision: z.string().regex(/^[a-f0-9]{64}$/), pathname: name, packId: name, packVersion: name, rendererId: name, rendererVersion: name, rendererDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const request = z.object({ workspaceId: name, revision: z.string().regex(/^[a-f0-9]{64}$/), pathname: name, operationId: z.uuid(), target: z.object({ renderedNodeId: name, providerId: name, recordId: name, nodeId: name }).strict(), change: z.discriminatedUnion("kind", [z.object({ kind: z.literal("field"), prop: name, value: z.json() }).strict(), z.object({ kind: z.literal("reorder"), direction: z.enum(["up", "down"]) }).strict(), z.object({ kind: z.literal("reorder-placement"), direction: z.enum(["up", "down"]) }).strict(), z.object({ kind: z.literal("remove") }).strict()]) }).strict();
const envelope = z.object({ version: z.literal(1), origin: z.string().url(), actorId: z.uuid(), sessionId: z.uuid(), identity, request }).strict();
export type PendingHostEdit = z.infer<typeof envelope>;
const ownerKey = "zudo-host-document-actor-v1";
const sessionKey = "zudo-host-document-session-v1";
const prefix = "zudo-host-document-recovery-v1:";
const owner = (storage: Storage, key: string, id: () => string) => {
  const existing = storage.getItem(key);
  if (existing) { if (!z.uuid().safeParse(existing).success) throw new Error("Recovery identity is malformed; preserve stored recovery data before repairing it."); return existing; }
  const value = id(); storage.setItem(key, value); return value;
};
/** Browser-profile actor is durable; session identity is provenance, never permission to auto-replay. */
export function createHostEditRecovery(storage: Storage, session: Storage, origin: string, id: () => string = () => crypto.randomUUID()) {
  const actorId = owner(storage, ownerKey, id), sessionId = owner(session, sessionKey, id);
  const key = (operationId: string) => `${prefix}${actorId}:${operationId}`;
  const parse = (raw: string | null) => {
    if (!raw) return null;
    try {
      const result = envelope.safeParse(JSON.parse(raw));
      if (!result.success) return null;
      const value = result.data;
      return value.origin === origin && value.actorId === actorId && value.request.workspaceId === value.identity.workspaceId && value.request.revision === value.identity.revision && value.request.pathname === value.identity.pathname ? value : null;
    } catch { return null; }
  };
  return {
    sessionId,
    list(scope: HostDocumentIdentity): PendingHostEdit[] {
      const values: PendingHostEdit[] = [];
      for (let index = 0; index < storage.length; index++) {
        const name = storage.key(index); if (!name?.startsWith(`${prefix}${actorId}:`) || name.endsWith(":receipt")) continue;
        const value = parse(storage.getItem(name));
        if (!value) throw new Error("A retained operation is malformed or belongs to another origin. Preserve recovery storage before repair.");
        if (value && name === key(value.request.operationId) && value.identity.workspaceId === scope.workspaceId && value.identity.packId === scope.packId && value.identity.rendererId === scope.rendererId) values.push(value);
      }
      return values.sort((a, b) => a.request.operationId.localeCompare(b.request.operationId));
    },
    save(scope: HostDocumentIdentity, input: unknown): PendingHostEdit {
      const value = envelope.parse({ version: 1, origin, actorId, sessionId, identity: scope, request: input });
      if (value.request.workspaceId !== scope.workspaceId || value.request.revision !== scope.revision || value.request.pathname !== scope.pathname) throw new Error("Recovery request differs from its reviewed identity.");
      const name = key(value.request.operationId), bytes = JSON.stringify(value), existing = storage.getItem(name);
      if (existing !== null && existing !== bytes) throw new Error("Operation identity already has another retained request.");
      storage.setItem(name, bytes);
      if (storage.getItem(name) !== bytes) throw new Error("Pending save could not be durably retained; nothing was sent.");
      return value;
    },
    complete(value: PendingHostEdit, receipt?: unknown) {
      const name = key(value.request.operationId), stored = parse(storage.getItem(name));
      if (!stored || JSON.stringify(stored) !== JSON.stringify(value)) throw new Error("Retained operation changed; preserve it for recovery.");
      if (receipt !== undefined) storage.setItem(`${name}:receipt`, JSON.stringify({ identity: value.identity, request: value.request, receipt }));
      storage.removeItem(name);
    },
  };
}
