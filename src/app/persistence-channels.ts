// Refresh hints are narrow by domain: each consumer lists the persisted inputs
// it reads, including cross-domain inputs such as Mapping's Content schema.
// Workspace changes invalidate every domain selection. Hints deliberately stay
// wide across workspaces because the channel carries no workspace identity:
// another window may ask us to re-read, but persisted per-workspace tokens still
// decide capture coherence and optimistic concurrency.

import { subscribePersistenceChanges } from "../shared/persistence-generation";
import { COMPOSITION_FILE_PROVIDER_CHANNEL } from "../composer/storage/file-provider";
import { CONTENT_FILE_PROVIDER_DOMAIN } from "../content/storage/file-provider";
import { MAPPING_FILE_PROVIDER_DOMAIN } from "../mapping/storage/file-provider";
import { SITEMAP_FILE_PROVIDER_DOMAIN } from "../sitemapper/storage/file-provider";
import { WORKSPACE_FILE_PROVIDER_DOMAIN } from "./workspace-storage";

/** Media is not workspace scoped, and not every listener wants it. */
export const ASSET_PERSISTENCE_CHANNEL = "assets";

/** The workspace registry plus the four authoring domains. */
export const AUTHORING_PERSISTENCE_CHANNELS: readonly string[] = Object.freeze([
  WORKSPACE_FILE_PROVIDER_DOMAIN,
  COMPOSITION_FILE_PROVIDER_CHANNEL,
  CONTENT_FILE_PROVIDER_DOMAIN,
  MAPPING_FILE_PROVIDER_DOMAIN,
  SITEMAP_FILE_PROVIDER_DOMAIN,
]);

export function isAuthoringPersistenceChannel(channel: string, dependencies: readonly string[]): boolean {
  return channel === WORKSPACE_FILE_PROVIDER_DOMAIN || dependencies.includes(channel);
}

/** Whole-project inspectors read every authoring domain, including project metadata. */
export const PROJECT_USAGE_CHANNELS = AUTHORING_PERSISTENCE_CHANNELS;

export function subscribeAuthoringPersistenceChanges(dependencies: readonly string[], listener: () => void): () => void {
  return subscribePersistenceChanges((channel) => { if (isAuthoringPersistenceChannel(channel, dependencies)) listener(); });
}
