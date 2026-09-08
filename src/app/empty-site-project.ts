import { createUuidIdFactory } from "../shared/id-factory";
import { SITEMAP_SCHEMA_VERSION } from "../sitemapper/model";
import { SITE_PROJECT_SCHEMA_VERSION, type SiteProject } from "../site-project/model/types";
import { SITE_PROJECT_PROVIDER_REGISTRY } from "../site-project/model/provider-registry";
import { serializeSiteProject } from "../site-project/model/canonical";
import { ACTIVE_SITE_PROJECT_COMPONENT_PACK_REQUIREMENT } from "./site-project-manifest";

// Keep the fallback factory's counter alive across creates as well as UUID calls.
const nextId = createUuidIdFactory();

/** An empty authoring workspace still needs declared providers and an active Sitemap. */
export function createEmptySiteProject(name: string): SiteProject {
  const id = nextId("project");
  const sitemapId = nextId("sitemap");
  const timestamp = new Date().toISOString();
  const registry = SITE_PROJECT_PROVIDER_REGISTRY;
  const sitemapProviderId = registry.sitemaps["sitemap-filesystem"].logicalId;
  return {
    schemaVersion: SITE_PROJECT_SCHEMA_VERSION,
    id,
    name,
    componentPack: { ...ACTIVE_SITE_PROJECT_COMPONENT_PACK_REQUIREMENT },
    providers: {
      compositions: [{ id: registry.compositions.files.logicalId, records: [] }],
      content: [{ id: registry.content["content-filesystem"].logicalId, models: [], entries: [] }],
      mappings: [{ id: registry.mappings["mapping-filesystem"].logicalId, records: [] }],
      sitemaps: [{
        id: sitemapProviderId,
        records: [{
          id: sitemapId,
          createdAt: timestamp,
          updatedAt: timestamp,
          document: {
            schemaVersion: SITEMAP_SCHEMA_VERSION,
            id: sitemapId,
            name: "Sitemap",
            navigation: { primary: [], footer: [] },
            root: [{ id: nextId("home"), title: "Home", source: { kind: "unassigned" }, children: [] }],
          },
        }],
      }],
    },
    activeSitemap: { providerId: sitemapProviderId, recordId: sitemapId },
    collectionAttachments: [],
  };
}

/** Hash the canonical UTF-8 bytes used by the workspace baseline contract. */
export async function computeSiteProjectRevision(project: SiteProject): Promise<string> {
  const bytes = new TextEncoder().encode(serializeSiteProject(project));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
