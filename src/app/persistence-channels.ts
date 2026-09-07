// The refresh-hint channels the authoring application listens on.
//
// A hint carries its domain rather than a store identity, because the
// workspace is a request header the browser sends rather than part of the
// store's name.
//
// The practical consequence is that two windows open on *different* workspaces
// now hint each other. That is harmless: a hint only asks a listener to re-read,
// and every correctness decision — capture coherence, optimistic concurrency —
// still rests on persisted mutation tokens, which are per workspace. Widening a
// refresh is a redundant read; narrowing one would be a stale screen.

import { COMPOSITION_FILE_PROVIDER_CHANNEL } from "../composer/storage/file-provider";
import { CONTENT_FILE_PROVIDER_DOMAIN } from "../content/storage/file-provider";
import { MAPPING_FILE_PROVIDER_DOMAIN } from "../mapping/storage/file-provider";
import { SITEMAP_FILE_PROVIDER_DOMAIN } from "../sitemapper/storage/file-provider";
import { WORKSPACE_FILE_PROVIDER_DOMAIN } from "./workspace-storage";

/** Media is not workspace scoped, and not every listener wants it. */
export const MEDIA_PERSISTENCE_CHANNEL = "media";

/** The workspace registry plus the four authoring domains. */
export const AUTHORING_PERSISTENCE_CHANNELS: readonly string[] = Object.freeze([
  WORKSPACE_FILE_PROVIDER_DOMAIN,
  COMPOSITION_FILE_PROVIDER_CHANNEL,
  CONTENT_FILE_PROVIDER_DOMAIN,
  MAPPING_FILE_PROVIDER_DOMAIN,
  SITEMAP_FILE_PROVIDER_DOMAIN,
]);

export function isAuthoringPersistenceChannel(channel: string): boolean {
  return AUTHORING_PERSISTENCE_CHANNELS.includes(channel);
}
