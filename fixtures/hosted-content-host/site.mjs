// The host's own definitions. In a real host these come from its committed
// source; the editor never supplies any of them.
import { defineComponentPack } from "@zudo-composer/component-contract";

const TIMESTAMP = "2026-10-12T00:00:00.000Z";
export const PROVIDER_ID = "content-filesystem";
export const BASELINE_REVISION = "fixture-baseline-1";
export const ACTOR = { subject: "client-editor@example.test" };

export const componentPack = defineComponentPack({ packId: "hosted-content-host", packVersion: "1.0.0", components: [] });

const courses = {
  id: "courses", createdAt: TIMESTAMP, updatedAt: TIMESTAMP,
  document: {
    schemaVersion: 1, id: "courses", name: "Courses", description: "Course summaries", kind: "collection",
    fields: [
      { id: "title", key: "title", label: "Title", required: true, kind: "text" },
      { id: "slug", key: "slug", label: "Slug", required: true, kind: "slug" },
      { id: "price", key: "price", label: "Price", required: true, kind: "number" },
      { id: "summary", key: "summary", label: "Summary", required: false, kind: "markdown" },
    ],
  },
};

/** @param {string} id @param {string} title @param {string} slug @param {number} price */
const course = (id, title, slug, price) => ({
  schemaVersion: 1, id, modelId: "courses", createdAt: TIMESTAMP, updatedAt: TIMESTAMP, lifecycle: "published", generation: 0,
  values: { title, slug, price, summary: "" },
});

export const project = {
  schemaVersion: 2, id: "hosted-content-host", name: "Hosted content host",
  componentPack: { contractVersion: componentPack.manifest.contractVersion, packId: "hosted-content-host", packVersion: "1.0.0" },
  providers: {
    compositions: [{ id: "files", records: [{ id: "home", createdAt: TIMESTAMP, updatedAt: TIMESTAMP, document: { schemaVersion: 2, id: "home", name: "Home", root: [] } }] }],
    content: [{ id: PROVIDER_ID, models: [courses], entries: [course("watercolor", "水彩画入門", "watercolor", 12000), course("oil", "油彩の基礎", "oil", 15000)] }],
    mappings: [{ id: "mapping-filesystem", records: [] }],
    sitemaps: [{ id: "sitemap-filesystem", records: [{ id: "main", createdAt: TIMESTAMP, updatedAt: TIMESTAMP, document: { schemaVersion: 3, id: "main", name: "Main", navigation: { primary: [], footer: [] }, root: [{ id: "home", title: "Home", source: { kind: "composition", ref: { providerId: "files", recordId: "home" } }, children: [] }] } }] }],
  },
  activeSitemap: { providerId: "sitemap-filesystem", recordId: "main" },
  collectionAttachments: [],
};

/**
 * Trusted policy: copy and price are editable; the slug keeps its route.
 * @type {import("zudo-composer/content").HostContentPolicy}
 */
export const policy = {
  projectId: project.id,
  providerId: PROVIDER_ID,
  models: { courses: { fields: ["title", "price", "summary"], operations: ["put-entry-values"] } },
};
