import { readContentGraph, type ContentProvider, type ContentMediaUse, type ContentFieldDefinition, type ContentValueSchema } from "../../content";
import type { JsonValue } from "@zudo-composer/component-contract";
import type { MediaAssetRef } from "../model";

export type MediaUse = ContentMediaUse;
export interface MediaContentLocation { providerId: string; modelId: string; entryId: string; fieldId: string; valuePath: readonly (string | number)[] }
export interface MediaUsageLocation extends MediaContentLocation { modelName: string; entryTitle: string; fieldLabel: string; use: MediaUse }
export interface MediaUsageScan {
  status: "complete" | "incomplete" | "unavailable";
  locations: readonly MediaUsageLocation[];
  tokens: Readonly<Record<string, number>>;
  message: string;
}
export interface MediaInsertionTarget extends MediaContentLocation {
  modelName: string; entryTitle: string; fieldLabel: string;
  kind: MediaUse["kind"]; append: boolean; mutationToken: number;
}
export interface MediaContentServices {
  scan(asset: MediaAssetRef): Promise<MediaUsageScan>;
  isCurrent(scan: MediaUsageScan): Promise<boolean>;
  targets(): Promise<readonly MediaInsertionTarget[]>;
  insert(target: MediaInsertionTarget, value: MediaUse): Promise<void>;
}

/** Domain-only adapter. Enumerates whole provider snapshots, never UI pages. */
export function createMediaContentServices(providers: readonly ContentProvider[], flush: () => Promise<unknown>): MediaContentServices {
  const stores = providers.map(({ store }) => store);
  const capture = async () => {
    const result = await flush();
    if (result && typeof result === "object" && "status" in result && result.status !== "ready") throw new Error("Save pending Content changes before inspecting Media uses.");
    if (!stores.length) throw new Error("Authoritative Content providers are unavailable.");
    return readContentGraph(stores);
  };
  return {
    async scan(asset) {
      try {
        const graph = await capture();
        if (graph.status !== "ready") return { status: "unavailable", locations: [], tokens: {}, message: graph.message };
        const locations = graph.index.mediaUses.filter(({ use }) => use.asset.providerId === asset.providerId && use.asset.assetId === asset.assetId).map(({ location, use }) => {
          const snapshot = graph.snapshots.find(({ providerId }) => providerId === location.entry.providerId)!;
          const model = snapshot.models.find(({ id }) => id === location.entry.modelId)!;
          const entry = snapshot.entries.find(({ id }) => id === location.entry.recordId)!;
          return { providerId: snapshot.providerId, modelId: model.id, entryId: entry.id, fieldId: String(location.path[0]),
            valuePath: location.path.slice(1), modelName: model.document.name, entryTitle: entry.id,
            fieldLabel: model.document.fields.find(({ id }) => id === location.fieldId)?.label ?? location.fieldId, use };
        });
        return { status: graph.index.complete ? "complete" : "incomplete", locations,
          tokens: Object.fromEntries(graph.snapshots.map((snapshot) => [snapshot.providerId, snapshot.mutationToken])),
          message: graph.index.complete ? "Complete structured Content scan. Raw URL or Markdown references may also exist; this does not prove the asset is unused." : "The authoritative Content graph is incomplete; trash is blocked." };
      } catch (error) { return { status: "unavailable", locations: [], tokens: {}, message: error instanceof Error ? error.message : "Content scan unavailable." }; }
    },
    async isCurrent(scan) {
      if (scan.status !== "complete" || Object.keys(scan.tokens).length !== stores.length) return false;
      try { return (await Promise.all(stores.map(async (store) => { const snapshot = await store.readAll(); return snapshot.providerId === store.provider.id && snapshot.mutationToken === scan.tokens[store.provider.id]; }))).every(Boolean); }
      catch { return false; }
    },
    async targets() {
      const graph = await capture();
      if (graph.status !== "ready" || !graph.index.complete) throw new Error("A complete Content graph is required for insertion.");
      const targets: MediaInsertionTarget[] = [];
      for (const snapshot of graph.snapshots.filter((snapshot) => stores.some((store) => store.provider.id === snapshot.providerId && store.transactionScope === "provider"))) for (const entry of snapshot.entries) {
        const model = snapshot.models.find(({ id }) => id === entry.modelId)!;
        const walk = (schema: ContentValueSchema, value: JsonValue | undefined, field: ContentFieldDefinition, path: (string | number)[]) => {
          if (schema.kind === "media-use" || (schema.kind === "list" && schema.item.kind === "media-use")) {
            targets.push({ providerId: snapshot.providerId, modelId: model.id, entryId: entry.id, fieldId: field.id, valuePath: path,
              modelName: model.document.name, entryTitle: entry.id, fieldLabel: field.label, kind: schema.kind === "media-use" ? schema.use : (schema.item as { use: MediaUse["kind"] }).use,
              append: schema.kind === "list", mutationToken: snapshot.mutationToken });
          } else if (schema.kind === "object" && value && typeof value === "object" && !Array.isArray(value)) {
            for (const child of schema.fields) walk(child, (value as Record<string, JsonValue>)[child.id], field, [...path, child.id]);
          } else if (schema.kind === "list" && Array.isArray(value)) value.forEach((item, index) => walk(schema.item, item, field, [...path, index]));
        };
        for (const field of model.document.fields) walk(field, entry.values[field.id], field, []);
      }
      return targets;
    },
    async insert(target, value) {
      if (target.kind !== value.kind) throw new Error("The presentation does not match this Content field.");
      const store = stores.find(({ provider }) => provider.id === target.providerId);
      if (!store || store.transactionScope !== "provider") throw new Error("This Content destination is not writable.");
      const snapshot = await store.readAll();
      if (snapshot.mutationToken !== target.mutationToken) throw new Error("Content changed. Reload the destination before inserting.");
      const entry = snapshot.entries.find(({ id, modelId }) => id === target.entryId && modelId === target.modelId);
      if (!entry) throw new Error("The Content destination is missing.");
      const field = snapshot.models.find(({ id }) => id === target.modelId)?.document.fields.find(({ id }) => id === target.fieldId);
      if (!field || !Array.isArray(target.valuePath)) throw new Error("The Content field is missing.");
      let schema: ContentValueSchema = field;
      let at: JsonValue | undefined = entry.values[field.id];
      for (const part of target.valuePath) {
        if (schema.kind === "object" && typeof part === "string") {
          const child = schema.fields.find(({ id }) => id === part);
          if (!child || !at || typeof at !== "object" || Array.isArray(at)) throw new Error("Invalid object-field destination.");
          schema = child; at = (at as Record<string, JsonValue>)[part];
        } else if (schema.kind === "list" && typeof part === "number" && Number.isSafeInteger(part) && part >= 0 && Array.isArray(at) && part < at.length) {
          schema = schema.item; at = at[part];
        } else throw new Error("Invalid nested Content destination.");
      }
      const matches = target.append ? schema.kind === "list" && schema.item.kind === "media-use" && schema.item.use === value.kind : schema.kind === "media-use" && schema.use === value.kind;
      if (!matches) throw new Error("The destination schema does not match the selected presentation.");
      const record = structuredClone(entry);
      let parent: Record<string | number, JsonValue> = record.values;
      const path = [target.fieldId, ...target.valuePath];
      for (const part of path.slice(0, -1)) {
        const next = parent[part];
        if (next === null || typeof next !== "object") throw new Error("The nested Content destination changed.");
        parent = next as Record<string | number, JsonValue>;
      }
      const key = path.at(-1)!;
      if (target.append && parent[key] !== undefined && !Array.isArray(parent[key])) throw new Error("The destination is no longer a list.");
      parent[key] = (target.append ? [...(parent[key] as JsonValue[] | undefined ?? []), value] : value) as unknown as JsonValue;
      await store.transact({ expectedMutationToken: target.mutationToken, operations: [{ kind: "put-entry", record }] });
    },
  };
}
