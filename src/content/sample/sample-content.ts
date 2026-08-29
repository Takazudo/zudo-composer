import { createContentEntryRecord, createContentModelRecord } from "../library";
import type { ContentSeed } from "../library";
import type { ContentFieldDefinition } from "../model";

export const SAMPLE_CONTENT_IDS = {
  collection: "sample-articles",
  single: "sample-site-settings",
  titleField: "sample-title",
  slugField: "sample-slug",
  publishedField: "sample-published",
  siteNameField: "sample-site-name",
  singleEntry: "sample-site-settings-entry",
} as const;
export const SAMPLE_CONTENT_TIMESTAMP = "2026-01-01T00:00:00.000Z";

const articleFields: ContentFieldDefinition[] = [
  { id: SAMPLE_CONTENT_IDS.titleField, key: "title", label: "Title", required: true, kind: "text" },
  { id: SAMPLE_CONTENT_IDS.slugField, key: "slug", label: "Slug", required: true, kind: "slug" },
  { id: SAMPLE_CONTENT_IDS.publishedField, key: "published", label: "Published", required: false, kind: "boolean" },
];

/** Deterministic explicit identities make retries and startFresh reproducible. */
export function createSampleContentSeed(collectionEntryCount = 75): ContentSeed {
  const collection = createContentModelRecord({ name: "Articles", kind: "collection", fields: articleFields }, { id: SAMPLE_CONTENT_IDS.collection, timestamp: SAMPLE_CONTENT_TIMESTAMP });
  const single = createContentModelRecord({ name: "Site settings", kind: "single", fields: [{ id: SAMPLE_CONTENT_IDS.siteNameField, key: "siteName", label: "Site name", required: true, kind: "text" }] }, { id: SAMPLE_CONTENT_IDS.single, timestamp: SAMPLE_CONTENT_TIMESTAMP });
  const entries = Array.from({ length: collectionEntryCount }, (_, index) => createContentEntryRecord(collection.id, {
    [SAMPLE_CONTENT_IDS.titleField]: `Article ${index + 1}`,
    [SAMPLE_CONTENT_IDS.slugField]: `article-${index + 1}`,
    [SAMPLE_CONTENT_IDS.publishedField]: index % 2 === 0,
  }, { id: `sample-article-${String(index + 1).padStart(3, "0")}`, timestamp: new Date(Date.parse(SAMPLE_CONTENT_TIMESTAMP) + index * 1000).toISOString() }));
  entries.push(createContentEntryRecord(single.id, { [SAMPLE_CONTENT_IDS.siteNameField]: "Zudo Composer" }, { id: SAMPLE_CONTENT_IDS.singleEntry, timestamp: SAMPLE_CONTENT_TIMESTAMP }));
  return { models: [collection, single], entries };
}
