import { createComponentCatalog } from "../../composer/model/types";
import { diagnoseDocument } from "../../composer/model/validate";
import { validateCompositionRecord } from "../../composer/library";
import { isValueValidForField, validateContentEntryRecord, validateContentModelRecord } from "../../content/model";
import { validateMappingRecord } from "../../mapping/model";
import { discoverMappingTargets } from "../../mapping/resolver/targets";
import { validateSitemapRecord } from "../../sitemapper/library";
import { isSitemapDisplayTitleFieldKind } from "../../sitemapper/model";
import { isJsonSafe, isPlainObject, isSafeRecordId } from "../../shared";
import { compareUnicodeCodePoints } from "./canonical";
import { isSiteProjectProviderId } from "./provider-registry";
import { SITE_PROJECT_SCHEMA_VERSION } from "./types";
import type {
  SiteProject,
  SiteProjectContentProvider,
  SiteProjectDiagnostic,
  SiteProjectDiagnosticCode,
  SiteProjectValidation,
  SiteProjectValidationContext,
} from "./types";

const PROJECT_KEYS = ["schemaVersion", "id", "name", "componentPack", "providers", "activeSitemap"] as const;
const PACK_KEYS = ["contractVersion", "packId", "packVersion"] as const;
const PROVIDERS_KEYS = ["compositions", "content", "mappings", "sitemaps"] as const;
const RECORD_PROVIDER_KEYS = ["id", "records"] as const;
const CONTENT_PROVIDER_KEYS = ["id", "models", "entries"] as const;
const REF_KEYS = ["providerId", "recordId"] as const;

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function diagnostic(
  diagnostics: SiteProjectDiagnostic[],
  code: SiteProjectDiagnosticCode,
  path: string,
  message: string,
): void {
  diagnostics.push({ severity: "error", code, message, path });
}

function recordRefKey(providerId: string, recordId: string): string {
  return `${providerId}\u0000${recordId}`;
}

function childPath(path: string, issuePath: string | undefined): string {
  if (!issuePath) return path;
  return issuePath.startsWith("[") ? `${path}${issuePath}` : `${path}.${issuePath}`;
}

function validateProviderShell(
  value: unknown,
  path: string,
  domain: "compositions" | "content" | "mappings" | "sitemaps",
  expectedKeys: readonly string[],
  diagnostics: SiteProjectDiagnostic[],
): value is Record<string, unknown> {
  if (!isPlainObject(value) || !exactKeys(value, expectedKeys)) {
    diagnostic(diagnostics, "invalid-provider", path, `Provider must contain exactly ${expectedKeys.join(", ")}.`);
    return false;
  }
  if (!isSiteProjectProviderId(domain, value.id)) {
    diagnostic(diagnostics, "unknown-provider", `${path}.id`, `Provider id ${JSON.stringify(value.id)} is not registered for ${domain}.`);
    return false;
  }
  return true;
}

function validateRefShape(value: unknown): value is { providerId: string; recordId: string } {
  return isPlainObject(value) && exactKeys(value, REF_KEYS)
    && typeof value.providerId === "string" && isSafeRecordId(value.recordId);
}

function compositionNodePaths(
  nodes: readonly { id: string; slots: Record<string, readonly unknown[]> }[],
  base: string,
  result = new Map<string, string>(),
): Map<string, string> {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    const path = `${base}[${index}]`;
    result.set(node.id, path);
    for (const slotId of Object.keys(node.slots).sort(compareUnicodeCodePoints)) {
      compositionNodePaths(
        node.slots[slotId] as readonly { id: string; slots: Record<string, readonly unknown[]> }[],
        `${path}.slots[${JSON.stringify(slotId)}]`,
        result,
      );
    }
  }
  return result;
}

function sitemapNodes(
  nodes: readonly { source: unknown; children: readonly unknown[] }[],
  base: string,
  visit: (source: unknown, path: string) => void,
): void {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    const path = `${base}[${index}]`;
    visit(node.source, `${path}.source`);
    sitemapNodes(node.children as readonly { source: unknown; children: readonly unknown[] }[], `${path}.children`, visit);
  }
}

function recordExistsElsewhere<T extends { id: string }>(
  providers: ReadonlyMap<string, readonly T[]>,
  expectedProviderId: string,
  recordId: string,
): boolean {
  for (const [providerId, records] of providers) {
    if (providerId !== expectedProviderId && records.some((record) => record.id === recordId)) return true;
  }
  return false;
}

/** Strictly validates a SiteProject and every cross-domain graph edge. */
export function validateSiteProject(value: unknown, context: SiteProjectValidationContext): SiteProjectValidation {
  const diagnostics: SiteProjectDiagnostic[] = [];
  if (!isPlainObject(value)) {
    return { ok: false, diagnostics: [{ severity: "error", code: "invalid-project", path: "$", message: "SiteProject must be a plain object." }] };
  }
  if (!isJsonSafe(value)) {
    return { ok: false, diagnostics: [{ severity: "error", code: "not-json-safe", path: "$", message: "SiteProject must contain only JSON-safe values." }] };
  }
  if (!exactKeys(value, PROJECT_KEYS)) {
    diagnostic(diagnostics, "invalid-keys", "$", "SiteProject must contain exactly schemaVersion, id, name, componentPack, providers, and activeSitemap.");
    return { ok: false, diagnostics };
  }
  if (typeof value.schemaVersion === "number" && value.schemaVersion > SITE_PROJECT_SCHEMA_VERSION) {
    diagnostic(diagnostics, "future-schema", "$.schemaVersion", `SiteProject schema ${value.schemaVersion} is newer than supported schema ${SITE_PROJECT_SCHEMA_VERSION}.`);
  } else if (value.schemaVersion !== SITE_PROJECT_SCHEMA_VERSION) {
    diagnostic(diagnostics, "invalid-schema-version", "$.schemaVersion", `SiteProject schemaVersion must be ${SITE_PROJECT_SCHEMA_VERSION}.`);
  }
  if (!isSafeRecordId(value.id)) diagnostic(diagnostics, "unsafe-id", "$.id", "SiteProject id must be a stable path-safe id.");
  if (typeof value.name !== "string" || value.name.trim().length === 0) diagnostic(diagnostics, "invalid-name", "$.name", "SiteProject name must be non-empty.");

  let packCompatible = false;
  if (!isPlainObject(value.componentPack) || !exactKeys(value.componentPack, PACK_KEYS)
    || !Number.isSafeInteger(value.componentPack.contractVersion) || (value.componentPack.contractVersion as number) < 1
    || typeof value.componentPack.packId !== "string" || value.componentPack.packId.length === 0
    || typeof value.componentPack.packVersion !== "string" || value.componentPack.packVersion.length === 0) {
    diagnostic(diagnostics, "invalid-component-pack", "$.componentPack", "componentPack must contain a positive contractVersion and non-empty packId and packVersion.");
  } else {
    const expected = context.componentPack;
    packCompatible = value.componentPack.contractVersion === expected.contractVersion
      && value.componentPack.packId === expected.packId
      && value.componentPack.packVersion === expected.packVersion;
    if (!packCompatible) {
      diagnostic(
        diagnostics,
        "component-pack-mismatch",
        "$.componentPack",
        `SiteProject requires ${value.componentPack.packId}@${value.componentPack.packVersion} contract ${value.componentPack.contractVersion}, but ${expected.packId}@${expected.packVersion} contract ${expected.contractVersion} is active.`,
      );
    }
  }

  if (!isPlainObject(value.providers) || !exactKeys(value.providers, PROVIDERS_KEYS)) {
    diagnostic(diagnostics, "invalid-keys", "$.providers", "providers must contain exactly compositions, content, mappings, and sitemaps.");
    return { ok: false, diagnostics: diagnostics.sort(compareDiagnostics) };
  }

  const compositions = new Map<string, SiteProject["providers"]["compositions"][number]["records"]>();
  const contentModels = new Map<string, SiteProjectContentProvider["models"]>();
  const contentEntries = new Map<string, SiteProjectContentProvider["entries"]>();
  const mappings = new Map<string, SiteProject["providers"]["mappings"][number]["records"]>();
  const sitemaps = new Map<string, SiteProject["providers"]["sitemaps"][number]["records"]>();
  const recordPaths = new Map<object, string>();

  const validateRecordProviders = <TRecord extends { id: string }>(
    domain: "compositions" | "mappings" | "sitemaps",
    rawProviders: unknown,
    target: Map<string, TRecord[]>,
    validator: (record: unknown) => { ok: true; record: TRecord } | { ok: false; issue: { code: string; message: string; path?: string } },
  ): void => {
    const base = `$.providers.${domain}`;
    if (!Array.isArray(rawProviders)) {
      diagnostic(diagnostics, "invalid-provider", base, `${domain} must be an array of provider collections.`);
      return;
    }
    const providerIds = new Set<string>();
    rawProviders.forEach((provider, providerIndex) => {
      const providerPath = `${base}[${providerIndex}]`;
      if (!validateProviderShell(provider, providerPath, domain, RECORD_PROVIDER_KEYS, diagnostics)) return;
      const providerId = provider.id as string;
      if (providerIds.has(providerId)) diagnostic(diagnostics, "duplicate-provider", `${providerPath}.id`, `Duplicate ${domain} provider ${JSON.stringify(providerId)}.`);
      providerIds.add(providerId);
      if (!Array.isArray(provider.records)) {
        diagnostic(diagnostics, "invalid-provider", `${providerPath}.records`, "Provider records must be an array.");
        return;
      }
      const records: TRecord[] = [];
      const recordIds = new Set<string>();
      provider.records.forEach((record, recordIndex) => {
        const path = `${providerPath}.records[${recordIndex}]`;
        const result = validator(record);
        if (!result.ok) {
          diagnostic(diagnostics, "malformed-record", childPath(path, result.issue.path), `${domain} record is invalid (${result.issue.code}): ${result.issue.message}`);
          return;
        }
        if (recordIds.has(result.record.id)) diagnostic(diagnostics, "duplicate-record", `${path}.id`, `Duplicate record id ${JSON.stringify(result.record.id)} in provider ${JSON.stringify(providerId)}.`);
        recordIds.add(result.record.id);
        records.push(result.record);
        recordPaths.set(result.record, path);
      });
      if (!target.has(providerId)) target.set(providerId, records);
    });
  };

  validateRecordProviders("compositions", value.providers.compositions, compositions, validateCompositionRecord);
  validateRecordProviders("mappings", value.providers.mappings, mappings, validateMappingRecord);
  validateRecordProviders("sitemaps", value.providers.sitemaps, sitemaps, validateSitemapRecord);

  if (!Array.isArray(value.providers.content)) {
    diagnostic(diagnostics, "invalid-provider", "$.providers.content", "content must be an array of provider collections.");
  } else {
    const providerIds = new Set<string>();
    value.providers.content.forEach((provider, providerIndex) => {
      const providerPath = `$.providers.content[${providerIndex}]`;
      if (!validateProviderShell(provider, providerPath, "content", CONTENT_PROVIDER_KEYS, diagnostics)) return;
      const providerId = provider.id as string;
      if (providerIds.has(providerId)) diagnostic(diagnostics, "duplicate-provider", `${providerPath}.id`, `Duplicate content provider ${JSON.stringify(providerId)}.`);
      providerIds.add(providerId);
      const validModels: SiteProjectContentProvider["models"] = [];
      const validEntries: SiteProjectContentProvider["entries"] = [];
      for (const [collectionName, records, validator] of [
        ["models", provider.models, validateContentModelRecord],
        ["entries", provider.entries, validateContentEntryRecord],
      ] as const) {
        if (!Array.isArray(records)) {
          diagnostic(diagnostics, "invalid-provider", `${providerPath}.${collectionName}`, `Content ${collectionName} must be an array.`);
          continue;
        }
        const recordIds = new Set<string>();
        records.forEach((record, recordIndex) => {
          const path = `${providerPath}.${collectionName}[${recordIndex}]`;
          const result = validator(record);
          if (!result.ok) {
            diagnostic(diagnostics, "malformed-record", childPath(path, result.issue.path), `Content ${collectionName.slice(0, -1)} is invalid (${result.issue.code}): ${result.issue.message}`);
            return;
          }
          if (recordIds.has(result.value.id)) diagnostic(diagnostics, "duplicate-record", `${path}.id`, `Duplicate content ${collectionName.slice(0, -1)} id ${JSON.stringify(result.value.id)} in provider ${JSON.stringify(providerId)}.`);
          recordIds.add(result.value.id);
          recordPaths.set(result.value, path);
          if (collectionName === "models") validModels.push(result.value as SiteProjectContentProvider["models"][number]);
          else validEntries.push(result.value as SiteProjectContentProvider["entries"][number]);
        });
      }
      if (!contentModels.has(providerId)) contentModels.set(providerId, validModels);
      if (!contentEntries.has(providerId)) contentEntries.set(providerId, validEntries);
    });
  }

  const componentCatalog = packCompatible ? createComponentCatalog(context.componentPack) : undefined;
  for (const [providerId, records] of compositions) {
    for (const record of records) {
      const path = recordPaths.get(record) ?? "$.providers.compositions";
      if (componentCatalog) {
        const packDiagnostics = diagnoseDocument(record.document, componentCatalog, { containingRecordId: record.id });
        const nodePaths = compositionNodePaths(record.document.root, `${path}.document.root`);
        for (const node of packDiagnostics.byId.values()) {
          for (const reason of node.reasons) diagnostic(diagnostics, "component-pack-incompatible", nodePaths.get(node.nodeId) ?? `${path}.document`, reason.message);
        }
        for (const reason of packDiagnostics.reuseReasons) diagnostic(diagnostics, "component-pack-incompatible", `${path}.document`, reason.message);
      }
      const binding = record.document.binding;
      if (binding) {
        const source = records.find((candidate) => candidate.id === binding.sourceRecordId);
        if (!source) {
          diagnostic(diagnostics, "dangling-composition-binding", `${path}.document.binding.sourceRecordId`, `Composition binding target ${JSON.stringify(recordRefKey(providerId, binding.sourceRecordId))} does not exist in the same provider.`);
        } else if (source.document.publication?.kind !== "global-template" || source.document.publication.outlet.id !== binding.outletId) {
          diagnostic(diagnostics, "invalid-composition-binding", `${path}.document.binding`, `Composition binding target does not expose Global-template outlet ${JSON.stringify(binding.outletId)}.`);
        }
      }
    }
  }

  for (const [providerId, entries] of contentEntries) {
    const models = contentModels.get(providerId) ?? [];
    const singleEntryCounts = new Map<string, number>();
    entries.forEach((entry) => {
      const entryPath = recordPaths.get(entry) ?? "$.providers.content";
      const path = `${entryPath}.modelId`;
      const model = models.find((candidate) => candidate.id === entry.modelId);
      if (!model) {
        const elsewhere = recordExistsElsewhere(contentModels, providerId, entry.modelId);
        diagnostic(diagnostics, elsewhere ? "wrong-content-provider" : "dangling-content-model", path, elsewhere
          ? `Content Entry model ${JSON.stringify(entry.modelId)} belongs to another provider.`
          : `Content Entry model ${JSON.stringify(entry.modelId)} does not exist in provider ${JSON.stringify(providerId)}.`);
        return;
      }
      if (model.document.kind === "single") {
        const count = (singleEntryCounts.get(model.id) ?? 0) + 1;
        singleEntryCounts.set(model.id, count);
        if (count > 1) {
          diagnostic(diagnostics, "single-content-cardinality", path, `Single Content model ${JSON.stringify(model.id)} permits at most one Entry in provider ${JSON.stringify(providerId)}.`);
        }
      }
      for (const [fieldId, fieldValue] of Object.entries(entry.values)) {
        const field = model.document.fields.find((candidate) => candidate.id === fieldId);
        if (!field) {
          diagnostic(diagnostics, "dangling-entry-field", `${entryPath}.values[${JSON.stringify(fieldId)}]`, `Content Entry value refers to unknown field ${JSON.stringify(fieldId)}.`);
        } else if (!isValueValidForField(field, fieldValue)) {
          diagnostic(diagnostics, "invalid-entry-value", `${entryPath}.values[${JSON.stringify(fieldId)}]`, `Content Entry value for field ${JSON.stringify(fieldId)} does not match ${field.kind}.`);
        }
      }
    });
  }

  for (const records of mappings.values()) {
    records.forEach((mapping) => {
      const path = `${recordPaths.get(mapping) ?? "$.providers.mappings"}.document`;
      const contentRef = mapping.document.contentModel;
      const knownContentProvider = isSiteProjectProviderId("content", contentRef.providerId);
      if (!knownContentProvider) diagnostic(diagnostics, "unknown-provider", `${path}.contentModel.providerId`, `Provider id ${JSON.stringify(contentRef.providerId)} is not registered for content.`);
      const models = knownContentProvider ? contentModels.get(contentRef.providerId) : undefined;
      const model = models?.find((candidate) => candidate.id === contentRef.recordId);
      if (knownContentProvider && !model) {
        const elsewhere = recordExistsElsewhere(contentModels, contentRef.providerId, contentRef.recordId);
        diagnostic(diagnostics, elsewhere ? "wrong-mapping-provider" : "dangling-mapping-reference", `${path}.contentModel`, elsewhere
          ? `Mapping Content model ${JSON.stringify(contentRef.recordId)} belongs to another provider.`
          : `Mapping Content model ${JSON.stringify(recordRefKey(contentRef.providerId, contentRef.recordId))} does not exist.`);
      }
      const compositionRef = mapping.document.composition;
      const knownCompositionProvider = isSiteProjectProviderId("compositions", compositionRef.providerId);
      if (!knownCompositionProvider) diagnostic(diagnostics, "unknown-provider", `${path}.composition.providerId`, `Provider id ${JSON.stringify(compositionRef.providerId)} is not registered for compositions.`);
      const compositionRecords = knownCompositionProvider ? compositions.get(compositionRef.providerId) : undefined;
      const composition = compositionRecords?.find((candidate) => candidate.id === compositionRef.recordId);
      if (knownCompositionProvider && !composition) {
        const elsewhere = recordExistsElsewhere(compositions, compositionRef.providerId, compositionRef.recordId);
        diagnostic(diagnostics, elsewhere ? "wrong-mapping-provider" : "dangling-mapping-reference", `${path}.composition`, elsewhere
          ? `Mapping Composition ${JSON.stringify(compositionRef.recordId)} belongs to another provider.`
          : `Mapping Composition ${JSON.stringify(recordRefKey(compositionRef.providerId, compositionRef.recordId))} does not exist.`);
      }
      const mappingTargets = composition && componentCatalog
        ? new Set(discoverMappingTargets(composition.document, componentCatalog).targets.map((target) => recordRefKey(target.target.nodeId, target.target.prop)))
        : undefined;
      const nodeIds = composition ? new Set(compositionNodePaths(composition.document.root, "").keys()) : undefined;
      mapping.document.bindings.forEach((binding, bindingIndex) => {
        const bindingPath = `${path}.bindings[${bindingIndex}]`;
        if (model && !model.document.fields.some((field) => field.id === binding.sourceFieldId)) {
          diagnostic(diagnostics, "dangling-mapping-field", `${bindingPath}.sourceFieldId`, `Mapping source field ${JSON.stringify(binding.sourceFieldId)} does not exist in Content model ${JSON.stringify(model.id)}.`);
        }
        if (nodeIds && !nodeIds.has(binding.target.nodeId)) {
          diagnostic(diagnostics, "dangling-mapping-target", `${bindingPath}.target.nodeId`, `Mapping target node ${JSON.stringify(binding.target.nodeId)} does not exist in Composition ${JSON.stringify(composition!.id)}.`);
        } else if (mappingTargets && !mappingTargets.has(recordRefKey(binding.target.nodeId, binding.target.prop))) {
          diagnostic(diagnostics, "dangling-mapping-target", `${bindingPath}.target.prop`, `Mapping target field ${JSON.stringify(binding.target.prop)} is not an available scalar field on node ${JSON.stringify(binding.target.nodeId)}.`);
        }
      });
    });
  }

  const activeSitemap = value.activeSitemap;
  if (!validateRefShape(activeSitemap)) {
    diagnostic(diagnostics, "invalid-active-sitemap", "$.activeSitemap", "activeSitemap must contain exactly a registered providerId and safe recordId.");
  } else if (!isSiteProjectProviderId("sitemaps", activeSitemap.providerId)) {
    diagnostic(diagnostics, "unknown-provider", "$.activeSitemap.providerId", `Provider id ${JSON.stringify(activeSitemap.providerId)} is not registered for sitemaps.`);
  } else if (!sitemaps.get(activeSitemap.providerId)?.some((record) => record.id === activeSitemap.recordId)) {
    diagnostic(diagnostics, "invalid-active-sitemap", "$.activeSitemap", `Active Sitemap ${JSON.stringify(recordRefKey(activeSitemap.providerId, activeSitemap.recordId))} does not exist.`);
  }

  for (const records of sitemaps.values()) {
    records.forEach((sitemap) => {
      const base = `${recordPaths.get(sitemap) ?? "$.providers.sitemaps"}.document.root`;
      sitemapNodes(sitemap.document.root, base, (source, sourcePath) => {
        if (!isPlainObject(source) || source.kind === "unassigned") return;
        const domain = source.kind === "composition" ? compositions : mappings;
        const ref = source.ref as { providerId: string; recordId: string };
        const registryDomain = source.kind === "composition" ? "compositions" : "mappings";
        if (!isSiteProjectProviderId(registryDomain, ref.providerId)) {
          diagnostic(diagnostics, "unknown-provider", `${sourcePath}.ref.providerId`, `Provider id ${JSON.stringify(ref.providerId)} is not registered for ${registryDomain}.`);
          return;
        }
        const recordsForProvider = domain.get(ref.providerId);
        const target = recordsForProvider?.find((candidate) => candidate.id === ref.recordId);
        if (!target) {
          const elsewhere = recordExistsElsewhere(domain as ReadonlyMap<string, readonly { id: string }[]>, ref.providerId, ref.recordId);
          diagnostic(diagnostics, elsewhere ? "wrong-sitemap-provider" : "dangling-sitemap-reference", `${sourcePath}.ref`, elsewhere
            ? `Sitemap ${source.kind} target ${JSON.stringify(ref.recordId)} belongs to another provider.`
            : `Sitemap ${source.kind} target ${JSON.stringify(recordRefKey(ref.providerId, ref.recordId))} does not exist.`);
          return;
        }
        if (source.kind === "mapping" && isPlainObject(source.route) && source.route.kind === "entry-field") {
          const mapping = target as SiteProject["providers"]["mappings"][number]["records"][number];
          const modelRef = mapping.document.contentModel;
          const model = contentModels.get(modelRef.providerId)?.find((candidate) => candidate.id === modelRef.recordId);
          const route = source.route as { kind: "entry-field"; fieldId: string; titleFieldId?: string };
          if (model && !model.document.fields.some((field) => field.id === route.fieldId)) {
            diagnostic(diagnostics, "dangling-sitemap-route-field", `${sourcePath}.route.fieldId`, `Sitemap route field ${JSON.stringify(route.fieldId)} does not exist in Content model ${JSON.stringify(model.id)}.`);
          }
          if (model && route.titleFieldId !== undefined) {
            const titleField = model.document.fields.find((field) => field.id === route.titleFieldId);
            if (!titleField) {
              diagnostic(diagnostics, "dangling-sitemap-title-field", `${sourcePath}.route.titleFieldId`, `Sitemap title field ${JSON.stringify(route.titleFieldId)} does not exist in Content model ${JSON.stringify(model.id)}.`);
            } else if (!isSitemapDisplayTitleFieldKind(titleField.kind)) {
              diagnostic(diagnostics, "invalid-sitemap-title-field", `${sourcePath}.route.titleFieldId`, `Sitemap title field ${JSON.stringify(route.titleFieldId)} must be text, long-text, or slug.`);
            }
          }
        }
      });
    });
  }

  diagnostics.sort(compareDiagnostics);
  return diagnostics.length === 0
    ? { ok: true, project: value as unknown as SiteProject, diagnostics: [] }
    : { ok: false, diagnostics };
}

function compareDiagnostics(left: SiteProjectDiagnostic, right: SiteProjectDiagnostic): number {
  return compareUnicodeCodePoints(left.path, right.path)
    || compareUnicodeCodePoints(left.code, right.code)
    || compareUnicodeCodePoints(left.message, right.message);
}
