// The workspace registry record, independent of where it is stored.
//
// The filesystem registry in `workspace-filesystem/` persists this exact shape.
// Everything here is pure model — validation, metadata projection and the
// project reconstruction — so the Node-side registry can reuse it without
// pulling browser code into a server process.

import { isSiteProjectProviderId, type SiteProject, type SiteProjectCollectionAttachment } from "../site-project/model";
import { isSafeRecordId } from "../shared";

export type WorkspaceProjectMetadata = Omit<SiteProject, "providers"> & { providers: { [K in keyof SiteProject["providers"]]: readonly { id: SiteProject["providers"][K][number]["id"] }[] } };

export interface WorkspaceRecord {
  schemaVersion: 1;
  id: string;
  mutationToken: number;
  status: "seeding" | "ready";
  metadata: WorkspaceProjectMetadata;
  baselineRevision: string;
  /** Fixed at creation; never replaced by a later injected active source. */
  seed?: SiteProject;
  /** No provider may reseed while an earlier failed attempt is being removed. */
  seedCleanupPending?: true;
  /** A resumed creation cannot bypass its external before-complete guard. */
  requiresBeforeComplete?: true;
}

/** The authored project reduced to provider identities; records live in the providers. */
export function workspaceProjectMetadata(project: SiteProject): WorkspaceProjectMetadata {
  const copy = structuredClone(project);
  return { ...copy, providers: {
    compositions: copy.providers.compositions.map(({ id }) => ({ id })),
    content: copy.providers.content.map(({ id }) => ({ id })),
    mappings: copy.providers.mappings.map(({ id }) => ({ id })),
    sitemaps: copy.providers.sitemaps.map(({ id }) => ({ id })),
  } };
}

function validAttachmentShape(value: unknown): value is SiteProjectCollectionAttachment {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const ref = (candidate: unknown, domain: "compositions" | "mappings"): candidate is { providerId: string; recordId: string } => {
    if (!candidate || typeof candidate !== "object") return false;
    const value = candidate as Record<string, unknown>;
    return Object.keys(value).length === 2 && typeof value.providerId === "string" && isSiteProjectProviderId(domain, value.providerId) && isSafeRecordId(value.recordId);
  };
  const target = item.target;
  return Object.keys(item).length === 5
    && isSafeRecordId(item.id)
    && Number.isSafeInteger(item.order) && Number(item.order) >= 0
    && ref(item.composition, "compositions") && ref(item.mapping, "mappings")
    && !!target && typeof target === "object"
    && Object.keys(target as object).length === 2
    && typeof (target as Record<string, unknown>).nodeId === "string" && Boolean((target as Record<string, unknown>).nodeId)
    && typeof (target as Record<string, unknown>).slotId === "string" && Boolean((target as Record<string, unknown>).slotId);
}

export function validateCollectionAttachments(value: unknown): value is readonly SiteProjectCollectionAttachment[] {
  if (!Array.isArray(value) || !value.every(validAttachmentShape)) return false;
  const ids = new Set<string>();
  return value.every((attachment) => !ids.has(attachment.id) && (ids.add(attachment.id), true));
}

export function projectFromWorkspace(record: WorkspaceRecord): SiteProject {
  const copy = structuredClone(record.metadata);
  return { ...copy, providers: {
    compositions: copy.providers.compositions.map(({ id }) => ({ id, records: [] })),
    content: copy.providers.content.map(({ id }) => ({ id, models: [], entries: [] })),
    mappings: copy.providers.mappings.map(({ id }) => ({ id, records: [] })),
    sitemaps: copy.providers.sitemaps.map(({ id }) => ({ id, records: [] })),
  } };
}

/**
 * Reject anything that is not a workspace record this build wrote. Malformed
 * metadata is never repaired, and never reconstructed from an activated source.
 */
export function validateWorkspaceRecord(value: unknown, fail: (message: string) => never): WorkspaceRecord {
  if (value && typeof value === "object" && "requiresBeforeComplete" in value && ((value as WorkspaceRecord).requiresBeforeComplete !== true || (value as WorkspaceRecord).status !== "seeding")) fail("Workspace creation guard metadata is invalid.");
  if (value && typeof value === "object" && "seedCleanupPending" in value && ((value as WorkspaceRecord).seedCleanupPending !== true || (value as WorkspaceRecord).status !== "seeding")) fail("Workspace seed cleanup metadata is invalid.");
  if (!value || typeof value !== "object" || (value as WorkspaceRecord).schemaVersion !== 1 || !Number.isSafeInteger((value as WorkspaceRecord).mutationToken) || (value as WorkspaceRecord).mutationToken < 0 || !["seeding", "ready"].includes((value as WorkspaceRecord).status) || !(value as WorkspaceRecord).metadata || !validateCollectionAttachments((value as WorkspaceRecord).metadata.collectionAttachments) || typeof (value as WorkspaceRecord).baselineRevision !== "string") fail("Workspace metadata is invalid; explicit recovery is required.");
  return value as WorkspaceRecord;
}
