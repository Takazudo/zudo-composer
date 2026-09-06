import { createMappingRecord } from "../../mapping/model";
import type { MappingCollectionQuery, MappingRecord } from "../../mapping/model";
import { createContentEntryRecord, createContentModelRecord } from "../../content/library";
import type {
  ContentEntryRecord,
  ContentFieldDefinition,
  ContentModelDocument,
  ContentModelRecord,
  ContentPresentation,
  ContentAssetRef,
} from "../../content/model";
import type { CompositionNode } from "../../composer/model/types";
import type { CompositionRecord } from "../../composer/library";
import { SITEMAP_SCHEMA_VERSION, type SitemapNode } from "../../sitemapper/model";
import type { SitemapRecord } from "../../sitemapper/library";
import { validateSiteProject } from "../model/validation";
import type { SiteProject, SiteProjectValidationContext } from "../model/types";
import bundledProject from "./sample-site-project.json";

/**
 * A second, optional SiteProject fixture for the generic Content workspace.
 *
 * The bundled `Sample Studio` project is the deployment smoke fixture. This
 * example is deliberately separate so loading it never changes the artifact
 * shipped by the Worker. Every identity below is authored, deterministic and
 * provider-qualified; there is no model-specific adapter behind this data.
 */
export const CATALOG_EDITORIAL_TIMESTAMP = "2026-09-01T00:00:00.000Z";
export const CATALOG_EDITORIAL_ATTEMPT_ID = "example-catalog-editorial-v1";
export const CATALOG_EDITORIAL_CONTENT_PROVIDER = "content-indexeddb" as const;
export const CATALOG_EDITORIAL_COMPOSITION_PROVIDER = "indexeddb" as const;
export const CATALOG_EDITORIAL_MAPPING_PROVIDER = "mapping-indexeddb" as const;
export const CATALOG_EDITORIAL_SITEMAP_PROVIDER = "sitemap-indexeddb" as const;

export const CATALOG_EDITORIAL_IDS = Object.freeze({
  project: "catalog-editorial-example",
  sitemap: "catalog-editorial-sitemap",
  models: {
    products: "catalog-products",
    guides: "catalog-guides",
    news: "catalog-news",
    support: "catalog-support-resources",
    series: "catalog-series",
    settings: "catalog-site-settings",
  },
  entries: {
    products: ["product-quiet-timer", "product-atlas-notebook", "product-river-lamp"],
    guides: ["guide-starting-small", "guide-making-space", "guide-evening-routine"],
    news: ["news-field-notes", "news-small-routines", "news-material-notes", "news-supply-notes"],
    support: ["support-setup", "support-care", "support-materials"],
    series: ["series-field-notes", "series-everyday-tools"],
    settings: "catalog-site-settings-entry",
  },
  compositions: {
    frame: "catalog-site-frame",
    home: "catalog-home-page",
    catalog: "catalog-index-page",
    product: "catalog-product-page",
    guide: "catalog-guide-page",
    newsIndex: "catalog-news-index-page",
    news: "catalog-news-page",
    supportIndex: "catalog-support-index-page",
    support: "catalog-support-page",
    series: "catalog-series-page",
    newsCard: "catalog-news-card",
  },
  mappings: {
    product: "catalog-product-page-mapping",
    guide: "catalog-guide-page-mapping",
    news: "catalog-news-page-mapping",
    support: "catalog-support-page-mapping",
    newsCard: "catalog-latest-news-mapping",
  },
  fields: {
    productTitle: "product-title",
    productSlug: "product-slug",
    productSummary: "product-summary",
    productBody: "product-body",
    productShopUrl: "product-shop-url",
    productResource: "product-resource",
    productSeries: "product-series",
    productGuides: "product-guides",
    productSupport: "product-support",
    guideTitle: "guide-title",
    guideSlug: "guide-slug",
    guideSummary: "guide-summary",
    guideBody: "guide-body",
    guideProduct: "guide-product",
    guideSupport: "guide-support",
    newsTitle: "news-title",
    newsSlug: "news-slug",
    newsSummary: "news-summary",
    newsPublishedOn: "news-published-on",
    newsBody: "news-body",
    newsGuides: "news-related-guides",
    newsSupport: "news-related-support",
    newsProduct: "news-product",
    supportTitle: "support-title",
    supportSlug: "support-slug",
    supportSummary: "support-summary",
    supportBody: "support-body",
    supportUrl: "support-resource-url",
    supportProducts: "support-products",
    seriesTitle: "series-title",
    seriesSlug: "series-slug",
    seriesDescription: "series-description",
    seriesProducts: "series-products",
    siteName: "site-name",
    siteTagline: "site-tagline",
    siteResource: "site-resource",
  },
} as const);

const IDs = CATALOG_EDITORIAL_IDS;
const CONTENT_PROVIDER = CATALOG_EDITORIAL_CONTENT_PROVIDER;
const COMPOSITION_PROVIDER = CATALOG_EDITORIAL_COMPOSITION_PROVIDER;
const MAPPING_PROVIDER = CATALOG_EDITORIAL_MAPPING_PROVIDER;
const TIMESTAMP = CATALOG_EDITORIAL_TIMESTAMP;

type ContentRef = { providerId: typeof CONTENT_PROVIDER; modelId: string; recordId: string };
type ModelRef = { providerId: typeof CONTENT_PROVIDER; recordId: string };

const modelRef = (recordId: string): ModelRef => ({ providerId: CONTENT_PROVIDER, recordId });
const entryRef = (modelId: string, recordId: string): ContentRef => ({ providerId: CONTENT_PROVIDER, modelId, recordId });

function textField(id: string, key: string, label: string, required = true): ContentFieldDefinition {
  return { id, key, label, required, kind: "text" };
}

function longTextField(id: string, key: string, label: string, required = true): ContentFieldDefinition {
  return { id, key, label, required, kind: "long-text" };
}

function markdownField(id: string, key: string, label: string, required = true): ContentFieldDefinition {
  return { id, key, label, required, kind: "markdown" };
}

function slugField(id: string, key: string, label = "Slug"): ContentFieldDefinition {
  return { id, key, label, required: true, kind: "slug" };
}

function dateField(id: string, key: string, label: string): ContentFieldDefinition {
  return { id, key, label, required: true, kind: "date" };
}

function urlField(id: string, key: string, label: string, required = true): ContentFieldDefinition {
  return { id, key, label, required, kind: "url" };
}

function referenceField(id: string, key: string, label: string, target: ModelRef, required = true): ContentFieldDefinition {
  return { id, key, label, required, kind: "reference", target };
}

function referenceListField(id: string, key: string, label: string, target: ModelRef, required = true): ContentFieldDefinition {
  return { id, key, label, required, kind: "reference-list", target, ordered: true };
}

function resourceField(id: string, key: string, label: string): ContentFieldDefinition {
  return { id, key, label, required: false, kind: "media-use", use: "link" };
}

function presentation(
  groups: ContentPresentation["groups"],
  views: ContentPresentation["views"],
  inverses: ContentPresentation["inverses"] = [],
): ContentModelDocument["presentation"] {
  return { groups, views, inverses };
}

function model(
  id: string,
  name: string,
  kind: "collection" | "single",
  fields: readonly ContentFieldDefinition[],
  modelPresentation: ContentModelDocument["presentation"],
): ContentModelRecord {
  return createContentModelRecord({ name, kind, description: `Synthetic ${name.toLowerCase()} model for the catalog editorial example.`, fields, presentation: modelPresentation }, { id, timestamp: TIMESTAMP });
}

function entry(
  modelId: string,
  id: string,
  values: ContentEntryRecord["values"],
  lifecycle: ContentEntryRecord["lifecycle"] = "published",
): ContentEntryRecord {
  const record = createContentEntryRecord(modelId, values, { id, timestamp: TIMESTAMP });
  return { ...record, lifecycle };
}


function node(
  id: string,
  componentId: string,
  props: CompositionNode["props"] = {},
  slots: CompositionNode["slots"] = {},
): CompositionNode {
  return { id, componentId, componentVersion: 1, props, slots };
}

function composition(
  id: string,
  name: string,
  root: CompositionNode[],
  binding = true,
): CompositionRecord {
  return {
    id,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    document: {
      schemaVersion: 2,
      id,
      name,
      root,
      ...(binding ? { binding: { sourceRecordId: IDs.compositions.frame, outletId: "main-content" } } : {}),
    },
  };
}

function collectionQuery(sortFieldId: string, limit = 100, pins: MappingCollectionQuery["pins"] = []): MappingCollectionQuery {
  return { publication: "published-only", conditions: [], sort: [{ fieldId: sortFieldId, direction: "asc" }], pins, limit };
}

function mapping(
  id: string,
  name: string,
  modelId: string,
  compositionId: string,
  mode: MappingRecord["document"]["mode"],
  bindings: Parameters<typeof createMappingRecord>[0]["bindings"],
): MappingRecord {
  return createMappingRecord({
    id,
    name,
    contentModel: modelRef(modelId),
    composition: { providerId: COMPOSITION_PROVIDER, recordId: compositionId },
    mode,
    bindings,
    createdAt: TIMESTAMP,
  });
}

function sitemapNode(id: string, title: string, source: SitemapNode["source"], slug: string | undefined, children: SitemapNode[] = []): SitemapNode {
  return { id, title, ...(slug === undefined ? {} : { slug }), source, children };
}

const productFields: ContentFieldDefinition[] = [
  textField(IDs.fields.productTitle, "title", "Title"),
  slugField(IDs.fields.productSlug, "slug"),
  longTextField(IDs.fields.productSummary, "summary", "Summary"),
  markdownField(IDs.fields.productBody, "body", "Description"),
  urlField(IDs.fields.productShopUrl, "shopUrl", "External shop link"),
  resourceField(IDs.fields.productResource, "resource", "Sample PDF (per-use label)"),
  referenceField(IDs.fields.productSeries, "series", "Series", modelRef(IDs.models.series)),
  referenceListField(IDs.fields.productGuides, "guides", "Related guides", modelRef(IDs.models.guides)),
  referenceListField(IDs.fields.productSupport, "support", "Support resources", modelRef(IDs.models.support)),
];
const guideFields: ContentFieldDefinition[] = [
  textField(IDs.fields.guideTitle, "title", "Title"),
  slugField(IDs.fields.guideSlug, "slug"),
  longTextField(IDs.fields.guideSummary, "summary", "Summary"),
  markdownField(IDs.fields.guideBody, "body", "Body"),
  referenceField(IDs.fields.guideProduct, "product", "Product", modelRef(IDs.models.products)),
  referenceListField(IDs.fields.guideSupport, "support", "Support resources", modelRef(IDs.models.support)),
];
const newsFields: ContentFieldDefinition[] = [
  textField(IDs.fields.newsTitle, "title", "Title"),
  slugField(IDs.fields.newsSlug, "slug"),
  longTextField(IDs.fields.newsSummary, "summary", "Summary"),
  dateField(IDs.fields.newsPublishedOn, "publishedOn", "Published on"),
  markdownField(IDs.fields.newsBody, "body", "Body"),
  referenceListField(IDs.fields.newsGuides, "relatedGuides", "Related guides" , modelRef(IDs.models.guides)),
  referenceListField(IDs.fields.newsSupport, "relatedSupport", "Related support", modelRef(IDs.models.support)),
  referenceField(IDs.fields.newsProduct, "product", "Product", modelRef(IDs.models.products)),
];
const supportFields: ContentFieldDefinition[] = [
  textField(IDs.fields.supportTitle, "title", "Title"),
  slugField(IDs.fields.supportSlug, "slug"),
  longTextField(IDs.fields.supportSummary, "summary", "Summary"),
  markdownField(IDs.fields.supportBody, "body", "Body"),
  urlField(IDs.fields.supportUrl, "resourceUrl", "Resource link"),
  referenceListField(IDs.fields.supportProducts, "products", "Products", modelRef(IDs.models.products)),
];
const seriesFields: ContentFieldDefinition[] = [
  textField(IDs.fields.seriesTitle, "title", "Title"),
  slugField(IDs.fields.seriesSlug, "slug"),
  markdownField(IDs.fields.seriesDescription, "description", "Description"),
  referenceListField(IDs.fields.seriesProducts, "products", "Products in order", modelRef(IDs.models.products)),
];
const settingsFields: ContentFieldDefinition[] = [
  textField(IDs.fields.siteName, "siteName", "Site name"),
  longTextField(IDs.fields.siteTagline, "tagline", "Tagline"),
  resourceField(IDs.fields.siteResource, "resource", "Site sample PDF"),
];

const productPresentation = presentation(
  [
    { id: "product-story", label: "Product story", fieldIds: [IDs.fields.productTitle, IDs.fields.productSummary, IDs.fields.productBody, IDs.fields.productResource] },
    { id: "product-links", label: "Links and relationships", fieldIds: [IDs.fields.productSlug, IDs.fields.productShopUrl, IDs.fields.productSeries, IDs.fields.productGuides, IDs.fields.productSupport] },
  ],
  [
    { id: "product-writing", label: "Writing task", fieldIds: [IDs.fields.productTitle, IDs.fields.productSummary, IDs.fields.productBody] },
    { id: "product-publish", label: "Publish task", fieldIds: [IDs.fields.productSlug, IDs.fields.productShopUrl, IDs.fields.productResource, IDs.fields.productSeries, IDs.fields.productGuides, IDs.fields.productSupport] },
  ],
  [
    { id: "product-guides-inverse", label: "Guides for this product", source: modelRef(IDs.models.guides), fieldId: IDs.fields.guideProduct },
    { id: "product-support-inverse", label: "Support for this product", source: modelRef(IDs.models.support), fieldId: IDs.fields.supportProducts },
    { id: "product-series-inverse", label: "Series containing this product", source: modelRef(IDs.models.series), fieldId: IDs.fields.seriesProducts },
  ],
);
const guidePresentation = presentation(
  [{ id: "guide-writing", label: "Guide writing", fieldIds: [IDs.fields.guideTitle, IDs.fields.guideSummary, IDs.fields.guideBody] }, { id: "guide-context", label: "Context", fieldIds: [IDs.fields.guideSlug, IDs.fields.guideProduct, IDs.fields.guideSupport] }],
  [{ id: "guide-writing-task", label: "Writing task", fieldIds: [IDs.fields.guideTitle, IDs.fields.guideSummary, IDs.fields.guideBody] }],
  [{ id: "guide-product-inverse", label: "Product guides", source: modelRef(IDs.models.products), fieldId: IDs.fields.productGuides }],
);
const newsPresentation = presentation(
  [{ id: "news-writing", label: "News writing", fieldIds: [IDs.fields.newsTitle, IDs.fields.newsSummary, IDs.fields.newsBody] }, { id: "news-context", label: "Publishing", fieldIds: [IDs.fields.newsSlug, IDs.fields.newsPublishedOn, IDs.fields.newsGuides, IDs.fields.newsSupport, IDs.fields.newsProduct] }],
  [{ id: "news-writing-task", label: "Writing task", fieldIds: [IDs.fields.newsTitle, IDs.fields.newsSummary, IDs.fields.newsBody] }, { id: "news-review-task", label: "Review dependencies", fieldIds: [IDs.fields.newsPublishedOn, IDs.fields.newsGuides, IDs.fields.newsSupport, IDs.fields.newsProduct] }],
);
const supportPresentation = presentation(
  [{ id: "support-writing", label: "Support writing", fieldIds: [IDs.fields.supportTitle, IDs.fields.supportSummary, IDs.fields.supportBody] }, { id: "support-context", label: "Resource details", fieldIds: [IDs.fields.supportSlug, IDs.fields.supportUrl, IDs.fields.supportProducts] }],
  [{ id: "support-writing-task", label: "Writing task", fieldIds: [IDs.fields.supportTitle, IDs.fields.supportSummary, IDs.fields.supportBody] }],
  [{ id: "support-product-inverse", label: "Product support", source: modelRef(IDs.models.products), fieldId: IDs.fields.productSupport }, { id: "support-guide-inverse", label: "Guide support", source: modelRef(IDs.models.guides), fieldId: IDs.fields.guideSupport }],
);
const seriesPresentation = presentation(
  [{ id: "series-writing", label: "Series writing", fieldIds: [IDs.fields.seriesTitle, IDs.fields.seriesDescription] }, { id: "series-order", label: "Ordered products", fieldIds: [IDs.fields.seriesSlug, IDs.fields.seriesProducts] }],
  [{ id: "series-writing-task", label: "Writing task", fieldIds: [IDs.fields.seriesTitle, IDs.fields.seriesDescription] }],
  [{ id: "series-product-inverse", label: "Product series", source: modelRef(IDs.models.products), fieldId: IDs.fields.productSeries }],
);
const settingsPresentation = presentation(
  [{ id: "settings-brand", label: "Brand", fieldIds: [IDs.fields.siteName, IDs.fields.siteTagline, IDs.fields.siteResource] }],
  [{ id: "settings-writing-task", label: "Writing task", fieldIds: [IDs.fields.siteName, IDs.fields.siteTagline] }],
);

const productsModel = model(IDs.models.products, "Products", "collection", productFields, productPresentation);
const guidesModel = model(IDs.models.guides, "Guides", "collection", guideFields, guidePresentation);
const newsModel = model(IDs.models.news, "News", "collection", newsFields, newsPresentation);
const supportModel = model(IDs.models.support, "Support resources", "collection", supportFields, supportPresentation);
const seriesModel = model(IDs.models.series, "Series", "collection", seriesFields, seriesPresentation);
const settingsModel = model(IDs.models.settings, "Site settings", "single", settingsFields, settingsPresentation);

const productEntry = (id: string, title: string, slug: string, summary: string, body: string, shopUrl: string, seriesId: string, guideIds: string[], supportIds: string[]) => entry(IDs.models.products, id, {
  [IDs.fields.productTitle]: title,
  [IDs.fields.productSlug]: slug,
  [IDs.fields.productSummary]: summary,
  [IDs.fields.productBody]: body,
  [IDs.fields.productShopUrl]: shopUrl,
  [IDs.fields.productSeries]: entryRef(IDs.models.series, seriesId),
  [IDs.fields.productGuides]: guideIds.map((guideId) => entryRef(IDs.models.guides, guideId)),
  [IDs.fields.productSupport]: supportIds.map((supportId) => entryRef(IDs.models.support, supportId)),
});

const guideEntry = (id: string, title: string, slug: string, summary: string, body: string, productId: string, supportIds: string[]) => entry(IDs.models.guides, id, {
  [IDs.fields.guideTitle]: title,
  [IDs.fields.guideSlug]: slug,
  [IDs.fields.guideSummary]: summary,
  [IDs.fields.guideBody]: body,
  [IDs.fields.guideProduct]: entryRef(IDs.models.products, productId),
  [IDs.fields.guideSupport]: supportIds.map((supportId) => entryRef(IDs.models.support, supportId)),
});

const newsEntry = (id: string, title: string, slug: string, summary: string, publishedOn: string, body: string, guideIds: string[], supportIds: string[], productId: string, lifecycle: ContentEntryRecord["lifecycle"] = "published") => entry(IDs.models.news, id, {
  [IDs.fields.newsTitle]: title,
  [IDs.fields.newsSlug]: slug,
  [IDs.fields.newsSummary]: summary,
  [IDs.fields.newsPublishedOn]: publishedOn,
  [IDs.fields.newsBody]: body,
  [IDs.fields.newsGuides]: guideIds.map((guideId) => entryRef(IDs.models.guides, guideId)),
  [IDs.fields.newsSupport]: supportIds.map((supportId) => entryRef(IDs.models.support, supportId)),
  [IDs.fields.newsProduct]: entryRef(IDs.models.products, productId),
}, lifecycle);

const supportEntry = (id: string, title: string, slug: string, summary: string, body: string, resourceUrl: string, productIds: string[]) => entry(IDs.models.support, id, {
  [IDs.fields.supportTitle]: title,
  [IDs.fields.supportSlug]: slug,
  [IDs.fields.supportSummary]: summary,
  [IDs.fields.supportBody]: body,
  [IDs.fields.supportUrl]: resourceUrl,
  [IDs.fields.supportProducts]: productIds.map((productId) => entryRef(IDs.models.products, productId)),
});

const entries: ContentEntryRecord[] = [
  productEntry(IDs.entries.products[0], "Quiet Timer", "quiet-timer", "A tactile timer for giving one small task a clear beginning and end.", "## Make one interval visible\n\nThe Quiet Timer turns a vague intention into a short, visible interval. Keep it close to the page, set one duration, and let the next decision wait.", "https://shop.example.test/catalog/quiet-timer", IDs.entries.series[0], [IDs.entries.guides[0]], [IDs.entries.support[0], IDs.entries.support[1]]),
  productEntry(IDs.entries.products[1], "Atlas Notebook", "atlas-notebook", "A lay-flat notebook for maps, questions, and the notes that connect them.", "## Leave room for the middle\n\nThe Atlas Notebook is intentionally generous: keep a question on one page and the useful evidence on the next. The gap is part of the method.", "https://shop.example.test/catalog/atlas-notebook", IDs.entries.series[0], [IDs.entries.guides[1], IDs.entries.guides[0]], [IDs.entries.support[1]]),
  productEntry(IDs.entries.products[2], "River Lamp", "river-lamp", "A warm, low-glare lamp for evening reading and slow review.", "## Lower the visual noise\n\nRiver Lamp gives an evening workspace one calm pool of light. It is a reminder that review quality is also a question of attention.", "https://shop.example.test/catalog/river-lamp", IDs.entries.series[1], [IDs.entries.guides[2]], [IDs.entries.support[0]]),
  guideEntry(IDs.entries.guides[0], "Starting with one interval", "starting-with-one-interval", "A simple way to make the first useful action easier to see.", "## Start smaller than the plan\n\nChoose one interval, name its finish line, and leave a short note about what changed. A visible finish is kinder than an ambitious queue.", IDs.entries.products[0], [IDs.entries.support[0]]),
  guideEntry(IDs.entries.guides[1], "Making space for the middle", "making-space-for-the-middle", "How to keep evidence close to the question without forcing an early conclusion.", "## Let the question stay open\n\nA good page holds the uncertainty long enough for another person to contribute. Keep the next choice close, but do not rush the answer.", IDs.entries.products[1], [IDs.entries.support[1]]),
  guideEntry(IDs.entries.guides[2], "An evening review", "an-evening-review", "A low-noise ritual for closing a day with one useful observation.", "## End with one observation\n\nBefore the light goes out, write down one thing you learned and one thing that can wait. The ritual is short enough to keep.", IDs.entries.products[2], [IDs.entries.support[0]]),
  newsEntry(IDs.entries.news[0], "Field notes from a quieter launch", "field-notes-from-a-quieter-launch", "A short account of reducing the surface area of a product story before release.", "2026-08-25", "## Keep the promise legible\n\nThe launch got clearer when every page answered one question. The rest became a useful list for the next loop.", [IDs.entries.guides[0], IDs.entries.guides[1]], [IDs.entries.support[0]], IDs.entries.products[0]),
  newsEntry(IDs.entries.news[1], "Small routines, durable tools", "small-routines-durable-tools", "What repeated use can teach us about the shape of a helpful catalog.", "2026-08-18", "## Notice what repeats\n\nA routine is evidence. We kept the details that made the next session easier and removed the ones that only looked impressive.", [IDs.entries.guides[2]], [IDs.entries.support[1]], IDs.entries.products[2]),
  newsEntry(IDs.entries.news[2], "Material notes for a shared shelf", "material-notes-for-a-shared-shelf", "A look at how support writing can stay close to product decisions.", "2026-08-09", "## Let support arrive early\n\nSupport is part of the product story, not a footnote after it. Link the practical answer while the decision is still being made.", [IDs.entries.guides[1], IDs.entries.guides[2]], [IDs.entries.support[1], IDs.entries.support[2]], IDs.entries.products[1]),
  newsEntry(IDs.entries.news[3], "Supply notes for the next season", "supply-notes-for-the-next-season", "A draft note with open questions for the next catalog review.", "2026-09-03", "## Questions to carry forward\n\nThis draft gathers the evidence we still need before the next catalog change. Review the linked guide and support notes together.", [IDs.entries.guides[1], IDs.entries.guides[0]], [IDs.entries.support[1], IDs.entries.support[2]], IDs.entries.products[1], "draft"),
  supportEntry(IDs.entries.support[0], "Set up a quiet workspace", "set-up-a-quiet-workspace", "A short checklist for placing a tool where it can be used without friction.", "## Before the first interval\n\nPut the tool within reach, choose one surface, and write the next action where you can see it.", "https://support.example.test/catalog/setup", [IDs.entries.products[0], IDs.entries.products[2]]),
  supportEntry(IDs.entries.support[1], "Care for paper and light", "care-for-paper-and-light", "Practical notes for keeping the notebook and lamp ready for another session.", "## Keep the ordinary details easy\n\nA clean page and a clear light are enough. Check the hinge, wipe the surface, and leave the next page open.", "https://support.example.test/catalog/care", [IDs.entries.products[1], IDs.entries.products[0]]),
  supportEntry(IDs.entries.support[2], "Materials and replacements", "materials-and-replacements", "Where to find the ordinary parts that keep a shared shelf useful.", "## Replace only what changed\n\nKeep the original shape of the tool whenever it still serves the work. Replace a part when it removes a real source of friction.", "https://support.example.test/catalog/materials", [IDs.entries.products[2], IDs.entries.products[1]]),
  entry(IDs.models.series, IDs.entries.series[0], {
    [IDs.fields.seriesTitle]: "Field notes",
    [IDs.fields.seriesSlug]: "field-notes",
    [IDs.fields.seriesDescription]: "An ordered set of tools for making one useful observation visible at a time.",
    [IDs.fields.seriesProducts]: [entryRef(IDs.models.products, IDs.entries.products[0]), entryRef(IDs.models.products, IDs.entries.products[1]), entryRef(IDs.models.products, IDs.entries.products[2])],
  }),
  entry(IDs.models.series, IDs.entries.series[1], {
    [IDs.fields.seriesTitle]: "Everyday tools",
    [IDs.fields.seriesSlug]: "everyday-tools",
    [IDs.fields.seriesDescription]: "A small group of objects for routines that need less noise and more room.",
    [IDs.fields.seriesProducts]: [entryRef(IDs.models.products, IDs.entries.products[2]), entryRef(IDs.models.products, IDs.entries.products[0])],
  }),
  entry(IDs.models.settings, IDs.entries.settings, {
    [IDs.fields.siteName]: "Fieldwork Catalog",
    [IDs.fields.siteTagline]: "Useful objects, clear notes, and support that arrives before the question gets lost.",
  }),
];

const frame = composition(IDs.compositions.frame, "Catalog site frame", [node("catalog-frame-container", "ui.container", {}, {
  content: [node("catalog-frame-stack", "ui.stack", { direction: "vertical", gap: "lg", align: "stretch", justify: "start" }, { content: [] })],
})], false);
frame.document.publication = { kind: "global-template", outlet: { id: "main-content", label: "Main content", target: { parentId: "catalog-frame-stack", slotId: "content" } } };

const home = composition(IDs.compositions.home, "Catalog home", [
  node("catalog-home-heading", "ui.hero", { eyebrow: "Fieldwork Catalog", heading: "Useful objects for a clearer day", lead: "A synthetic catalog for testing products, editorial notes, and practical support as one connected workspace.", variant: "secondary", actions: [{ label: "Browse the catalog", href: "/catalog", variant: "primary" }, { label: "Read the notes", href: "/journal", variant: "secondary" }] }),
  node("catalog-home-intro", "ui.prose-p", { children: "Every item has a reason to be here: a product, a guide, a support note, and a next question." }),
  node("catalog-home-latest-news", "ui.stack", { direction: "vertical", gap: "md", align: "stretch", justify: "start" }, { content: [] }),
  node("catalog-home-callout", "ui.callout", { tone: "muted", title: "A catalog is a conversation" }, { body: [node("catalog-home-callout-copy", "ui.prose-p", { children: "Latest notes are attached to this page from a collection Mapping; the page owns the slot, while Content owns the order." })] }),
]);
const catalog = composition(IDs.compositions.catalog, "Catalog index", [
  node("catalog-index-heading", "ui.section-heading", { eyebrow: "Catalog", heading: "Objects with a little room around them", intro: "Browse the product family, then follow the related guide or support note that makes the next action easier.", as: "h1" }),
  node("catalog-index-copy", "ui.prose-md", { markdown: "## Follow the useful thread\n\nProducts, Guides, and Support resources are separate canonical models. The route family composes them without copying the underlying data." }),
]);
const product = composition(IDs.compositions.product, "Product detail", [
  node("catalog-product-heading", "ui.section-heading", { eyebrow: "Product", heading: "A considered object", intro: "A useful product story leaves space for the next decision.", as: "h1" }),
  node("catalog-product-body", "ui.prose-md", { markdown: "## Product notes\n\nThis body is mapped from the canonical Product entry." }),
  node("catalog-product-shop", "ui.cta-button", { href: "https://shop.example.test/catalog", variant: "primary", arrow: true, children: "Visit external shop" }),
]);
const guide = composition(IDs.compositions.guide, "Guide detail", [
  node("catalog-guide-heading", "ui.section-heading", { eyebrow: "Guide", heading: "A small useful practice", intro: "A guide keeps one related decision close to the object.", as: "h1" }),
  node("catalog-guide-body", "ui.prose-md", { markdown: "## Guide notes\n\nThis body is mapped from the canonical Guide entry." }),
  node("catalog-guide-product", "ui.cta-button", { href: "/catalog", children: "Read about the related product", variant: "secondary", arrow: true }),
]);
const newsIndex = composition(IDs.compositions.newsIndex, "News index", [
  node("catalog-news-index-heading", "ui.section-heading", { eyebrow: "News", heading: "Notes from the work", intro: "Short observations about products, routines, and support.", as: "h1" }),
]);
const news = composition(IDs.compositions.news, "News detail", [
  node("catalog-news-heading", "ui.section-heading", { eyebrow: "News", heading: "A note from the work", intro: "The summary stays close to the full note.", as: "h1" }),
  node("catalog-news-date", "ui.prose-p", { children: "Published date" }),
  node("catalog-news-body", "ui.prose-md", { markdown: "## News notes\n\nThis body is mapped from the canonical News entry." }),
]);
const supportIndex = composition(IDs.compositions.supportIndex, "Support index", [
  node("catalog-support-index-heading", "ui.section-heading", { eyebrow: "Support", heading: "Practical answers", intro: "Support resources are part of the catalog, not a hidden afterthought.", as: "h1" }),
]);
const support = composition(IDs.compositions.support, "Support detail", [
  node("catalog-support-heading", "ui.section-heading", { eyebrow: "Support", heading: "A practical answer", intro: "Keep the next maintenance step close to the product.", as: "h1" }),
  node("catalog-support-body", "ui.prose-md", { markdown: "## Support notes\n\nThis body is mapped from the canonical Support resource." }),
  node("catalog-support-link", "ui.cta-button", { href: "https://support.example.test/catalog", variant: "secondary", arrow: true, children: "Open support resource" }),
]);
const series = composition(IDs.compositions.series, "Series detail", [
  node("catalog-series-heading", "ui.section-heading", { eyebrow: "Series", heading: "An ordered shelf", intro: "Series keeps a deliberate order over related Products.", as: "h1" }),
  node("catalog-series-copy", "ui.prose-md", { markdown: "## Order is part of the story\n\nThe Series entry stores its Products as an ordered reference-list. The editor can inspect and edit that order without duplicating Product data." }),
]);
const newsCard = composition(IDs.compositions.newsCard, "Latest news card", [
  node("catalog-news-card", "ui.card", { title: "Latest note", variant: "default", padding: "md" }, { body: [
    node("catalog-news-card-copy", "ui.prose-p", { children: "A short note from the catalog." }),
    node("catalog-news-card-date", "ui.prose-p", { children: "Published date" }),
  ] }),
], false);

const productMapping = mapping(IDs.mappings.product, "Product detail mapping", IDs.models.products, IDs.compositions.product, { kind: "collection", query: collectionQuery(IDs.fields.productTitle, 3, [
  { providerId: CONTENT_PROVIDER, modelId: IDs.models.products, recordId: IDs.entries.products[1] },
]) }, [
  { id: "product-title-binding", sourceFieldId: IDs.fields.productTitle, target: { nodeId: "catalog-product-heading", prop: "heading" }, transform: { kind: "identity" } },
  { id: "product-summary-binding", sourceFieldId: IDs.fields.productSummary, target: { nodeId: "catalog-product-heading", prop: "intro" }, transform: { kind: "truncate-160" } },
  { id: "product-body-binding", sourceFieldId: IDs.fields.productBody, target: { nodeId: "catalog-product-body", prop: "markdown" }, transform: { kind: "identity" } },
  { id: "product-shop-binding", sourceFieldId: IDs.fields.productShopUrl, target: { nodeId: "catalog-product-shop", prop: "href" }, transform: { kind: "identity" } },
]);
const guideMapping = mapping(IDs.mappings.guide, "Guide detail mapping", IDs.models.guides, IDs.compositions.guide, { kind: "collection", query: collectionQuery(IDs.fields.guideTitle) }, [
  { id: "guide-title-binding", sourceFieldId: IDs.fields.guideTitle, target: { nodeId: "catalog-guide-heading", prop: "heading" }, transform: { kind: "identity" } },
  { id: "guide-summary-binding", sourceFieldId: IDs.fields.guideSummary, target: { nodeId: "catalog-guide-heading", prop: "intro" }, transform: { kind: "truncate-160" } },
  { id: "guide-body-binding", sourceFieldId: IDs.fields.guideBody, target: { nodeId: "catalog-guide-body", prop: "markdown" }, transform: { kind: "identity" } },
  { id: "guide-product-binding", sourceFieldId: IDs.fields.guideProduct, projection: { kind: "route-link" }, target: { nodeId: "catalog-guide-product", prop: "href" }, transform: { kind: "identity" } },
]);
const newsMapping = mapping(IDs.mappings.news, "News detail mapping", IDs.models.news, IDs.compositions.news, { kind: "collection", query: { ...collectionQuery(IDs.fields.newsPublishedOn), publication: "include-drafts", sort: [{ fieldId: IDs.fields.newsPublishedOn, direction: "desc" }] } }, [
  { id: "news-title-binding", sourceFieldId: IDs.fields.newsTitle, target: { nodeId: "catalog-news-heading", prop: "heading" }, transform: { kind: "identity" } },
  { id: "news-summary-binding", sourceFieldId: IDs.fields.newsSummary, target: { nodeId: "catalog-news-heading", prop: "intro" }, transform: { kind: "truncate-160" } },
  { id: "news-date-binding", sourceFieldId: IDs.fields.newsPublishedOn, target: { nodeId: "catalog-news-date", prop: "children" }, transform: { kind: "date-medium" } },
  { id: "news-body-binding", sourceFieldId: IDs.fields.newsBody, target: { nodeId: "catalog-news-body", prop: "markdown" }, transform: { kind: "identity" } },
]);
const supportMapping = mapping(IDs.mappings.support, "Support detail mapping", IDs.models.support, IDs.compositions.support, { kind: "collection", query: collectionQuery(IDs.fields.supportTitle) }, [
  { id: "support-title-binding", sourceFieldId: IDs.fields.supportTitle, target: { nodeId: "catalog-support-heading", prop: "heading" }, transform: { kind: "identity" } },
  { id: "support-summary-binding", sourceFieldId: IDs.fields.supportSummary, target: { nodeId: "catalog-support-heading", prop: "intro" }, transform: { kind: "truncate-160" } },
  { id: "support-body-binding", sourceFieldId: IDs.fields.supportBody, target: { nodeId: "catalog-support-body", prop: "markdown" }, transform: { kind: "identity" } },
  { id: "support-url-binding", sourceFieldId: IDs.fields.supportUrl, target: { nodeId: "catalog-support-link", prop: "href" }, transform: { kind: "identity" } },
]);
const newsCardMapping = mapping(IDs.mappings.newsCard, "Latest News collection attachment", IDs.models.news, IDs.compositions.newsCard, { kind: "collection", query: { ...collectionQuery(IDs.fields.newsPublishedOn, 2), sort: [{ fieldId: IDs.fields.newsPublishedOn, direction: "desc" }] } }, [
  { id: "news-card-title-binding", sourceFieldId: IDs.fields.newsTitle, target: { nodeId: "catalog-news-card", prop: "title" }, transform: { kind: "identity" } },
  { id: "news-card-summary-binding", sourceFieldId: IDs.fields.newsSummary, target: { nodeId: "catalog-news-card-copy", prop: "children" }, transform: { kind: "truncate-160" } },
  { id: "news-card-date-binding", sourceFieldId: IDs.fields.newsPublishedOn, target: { nodeId: "catalog-news-card-date", prop: "children" }, transform: { kind: "date-medium" } },
]);

const sitemap: SitemapRecord = {
  id: IDs.sitemap,
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
  document: {
    schemaVersion: SITEMAP_SCHEMA_VERSION,
    id: IDs.sitemap,
    name: "Fieldwork Catalog sitemap",
    navigation: {
      primary: [
        { id: "catalog-primary-home", label: "Home", visible: true, destination: { kind: "route", nodeId: "catalog-home-node" } },
        { id: "catalog-primary-catalog", label: "Catalog", visible: true, destination: { kind: "route", nodeId: "catalog-index-node" } },
        { id: "catalog-primary-journal", label: "Journal", visible: true, destination: { kind: "route", nodeId: "catalog-news-index-node" } },
        { id: "catalog-primary-support", label: "Support", visible: true, destination: { kind: "route", nodeId: "catalog-support-index-node" } },
      ],
      footer: [
        { id: "catalog-footer-series", label: "Series", visible: true, destination: { kind: "route", nodeId: "catalog-series-node" } },
        { id: "catalog-footer-shop", label: "External shop", visible: true, destination: { kind: "external", url: "https://shop.example.test/catalog" } },
        { id: "catalog-footer-support", label: "Support resources", visible: true, destination: { kind: "route", nodeId: "catalog-support-index-node" } },
      ],
    },
    root: [sitemapNode("catalog-home-node", "Home", { kind: "composition", ref: { providerId: COMPOSITION_PROVIDER, recordId: IDs.compositions.home } }, undefined, [
      sitemapNode("catalog-index-node", "Catalog", { kind: "composition", ref: { providerId: COMPOSITION_PROVIDER, recordId: IDs.compositions.catalog } }, "catalog", [
        sitemapNode("catalog-product-node", "Products", { kind: "mapping", ref: { providerId: MAPPING_PROVIDER, recordId: IDs.mappings.product }, route: { kind: "entry-field", fieldId: IDs.fields.productSlug, titleFieldId: IDs.fields.productTitle } }, "products", [
          sitemapNode("catalog-guide-node", "Guides", { kind: "mapping", ref: { providerId: MAPPING_PROVIDER, recordId: IDs.mappings.guide }, route: { kind: "entry-field", fieldId: IDs.fields.guideSlug, titleFieldId: IDs.fields.guideTitle } }, "guides"),
          sitemapNode("catalog-product-support-node", "Support", { kind: "mapping", ref: { providerId: MAPPING_PROVIDER, recordId: IDs.mappings.support }, route: { kind: "entry-field", fieldId: IDs.fields.supportSlug, titleFieldId: IDs.fields.supportTitle } }, "support"),
        ]),
      ]),
      sitemapNode("catalog-news-index-node", "Journal", { kind: "composition", ref: { providerId: COMPOSITION_PROVIDER, recordId: IDs.compositions.newsIndex } }, "journal", [
        sitemapNode("catalog-news-node", "News", { kind: "mapping", ref: { providerId: MAPPING_PROVIDER, recordId: IDs.mappings.news }, route: { kind: "entry-field", fieldId: IDs.fields.newsSlug, titleFieldId: IDs.fields.newsTitle } }, "stories"),
      ]),
      sitemapNode("catalog-support-index-node", "Support", { kind: "composition", ref: { providerId: COMPOSITION_PROVIDER, recordId: IDs.compositions.supportIndex } }, "help", [
        sitemapNode("catalog-support-node", "Resources", { kind: "mapping", ref: { providerId: MAPPING_PROVIDER, recordId: IDs.mappings.support }, route: { kind: "entry-field", fieldId: IDs.fields.supportSlug, titleFieldId: IDs.fields.supportTitle } }, "resources"),
      ]),
      sitemapNode("catalog-series-node", "Series", { kind: "composition", ref: { providerId: COMPOSITION_PROVIDER, recordId: IDs.compositions.series } }, "series"),
    ]),
    ],
  },
};

/** Build a detached, deterministic current-schema example. */
export function createCatalogEditorialSiteProject(resource?: ContentAssetRef): SiteProject {
  const project: SiteProject = {
    schemaVersion: 2,
    id: IDs.project,
    name: "Fieldwork Catalog",
    componentPack: { ...bundledProject.componentPack, contractVersion: 2 },
    providers: {
      compositions: [{ id: COMPOSITION_PROVIDER, records: [frame, home, catalog, product, guide, newsIndex, news, supportIndex, support, series, newsCard] }],
      content: [{ id: CONTENT_PROVIDER, models: [productsModel, guidesModel, newsModel, supportModel, seriesModel, settingsModel], entries }],
      mappings: [{ id: MAPPING_PROVIDER, records: [productMapping, guideMapping, newsMapping, supportMapping, newsCardMapping] }],
      sitemaps: [{ id: CATALOG_EDITORIAL_SITEMAP_PROVIDER, records: [sitemap] }],
    },
    activeSitemap: { providerId: CATALOG_EDITORIAL_SITEMAP_PROVIDER, recordId: IDs.sitemap },
    collectionAttachments: [{ id: "catalog-latest-news-attachment", order: 0, composition: { providerId: COMPOSITION_PROVIDER, recordId: IDs.compositions.home }, target: { nodeId: "catalog-home-latest-news", slotId: "content" }, mapping: { providerId: MAPPING_PROVIDER, recordId: IDs.mappings.newsCard } }],
  };
  const detached = structuredClone(project);
  if (resource) for (const record of detached.providers.content[0]!.entries) {
    if (record.modelId === IDs.models.products) record.values[IDs.fields.productResource] = { kind: "link", asset: { ...resource }, label: `${record.values[IDs.fields.productTitle]}: blank sample PDF` };
    if (record.modelId === IDs.models.settings) record.values[IDs.fields.siteResource] = { kind: "link", asset: { ...resource }, label: "Site download: blank sample PDF" };
  }
  return detached;
}

/** Load a detached example only after the active component pack validates it. */
export function loadCatalogEditorialSiteProject(context: SiteProjectValidationContext, resource?: ContentAssetRef): SiteProject {
  const result = validateSiteProject(createCatalogEditorialSiteProject(resource), context);
  if (!result.ok) {
    const details = result.diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join("\n");
    throw new TypeError(`The catalog editorial example SiteProject is invalid.\n${details}`);
  }
  return result.project;
}
