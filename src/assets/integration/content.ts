import { readContentGraph, type ContentProvider, type ContentAssetUse, type ContentFieldDefinition, type ContentValueSchema } from "../../content";
import type { JsonValue } from "@zudo-composer/component-contract";
import type { AssetAssetRef } from "../model";
import type { ProjectAssetUsageInspection } from "../../site-project/assets/usage";
import type { AssetImpactLocation } from "../../site-project/assets/types";

export type AssetUse = ContentAssetUse;
export { assetDownloadMarkdown } from "./download";
export interface AssetContentLocation { providerId: string; modelId: string; entryId: string; fieldId: string; valuePath: readonly (string | number)[] }
export interface AssetUsageLocation extends AssetContentLocation { modelName: string; entryTitle: string; fieldLabel: string; use: AssetUse }
export interface AssetUsageScan {
  projectRevision?: string;
  additionalLocations?: readonly { location: AssetImpactLocation; href?: string }[];
  status: "complete" | "incomplete" | "unavailable";
  locations: readonly AssetUsageLocation[];
  tokens: Readonly<Record<string, number>>;
  message: string;
}
export interface AssetInsertionTarget extends AssetContentLocation {
  modelName: string; entryTitle: string; fieldLabel: string;
  kind: AssetUse["kind"]; append: boolean; mutationToken: number;
}
export interface AssetContentServices {
  subscribeChanges(listener: () => void): () => void;
  scan(asset: AssetAssetRef, fresh?: boolean): Promise<AssetUsageScan>;
  isCurrent(scan: AssetUsageScan): Promise<boolean>;
  targets(): Promise<readonly AssetInsertionTarget[]>;
  insert(target: AssetInsertionTarget, value: AssetUse): Promise<void>;
}

/** How many times a scan repeats a read that reported itself unstable. */
const STABLE_READ_ATTEMPTS = 3;

/** Domain-only adapter. Enumerates whole provider snapshots, never UI pages. */
export function createAssetContentServices(providers: readonly ContentProvider[], flush: () => Promise<unknown>, subscribeChanges: (listener: () => void) => () => void = () => () => undefined, impact?: ProjectAssetUsageInspection): AssetContentServices {
  const stores = providers.map(({ store }) => store);
  const listeners = new Set<() => void>();
  let stopChanges: (() => void) | undefined;
  /**
   * Cached scans, each tagged with the workspace generation it was STARTED in.
   * Clearing the map on a change is not enough on its own: a scan already in
   * flight resolves afterwards and would be cached as current, so a hint that
   * lands mid-scan used to leave the pre-change answer sitting in the cache for
   * the next caller — which is how Assets trash stayed blocked on a Content
   * entry that had already been deleted.
   */
  const scans = new Map<string, { generation: number; result: Promise<AssetUsageScan> }>();
  let generation = 0;
  const flushStatus = (value: unknown) => value && typeof value === "object" && "status" in value ? String((value as { status: unknown }).status) : "ready";
  const capture = async () => {
    // A flush reports `changed` when edits landed while it was saving. Nobody is
    // typing during an asset scan — that is the application's own churn settling
    // — so it is a flush to repeat rather than an answer. `failed` stays an
    // error: a save that did not land must not be scanned around.
    let result = await flush();
    for (let attempt = 1; flushStatus(result) === "changed" && attempt < STABLE_READ_ATTEMPTS; attempt += 1) result = await flush();
    if (flushStatus(result) !== "ready") throw new Error("Save pending Content changes before inspecting Assets uses.");
    if (!stores.length) throw new Error("Authoritative Content providers are unavailable.");
    for (let attempt = 1; ; attempt += 1) {
      const graph = await readContentGraph(stores);
      // `changed` is the capture asking to be repeated — an authoring write
      // landed between the read and its verification, which is ordinary now
      // that a capture is a provider round trip rather than a memory read. Only
      // a graph that never holds still is reported to the caller, because
      // nothing re-runs a scan that reported itself unusable.
      if (graph.status !== "changed" || attempt >= STABLE_READ_ATTEMPTS) return graph;
    }
  };
  return {
    subscribeChanges(listener) {
      const subscription = () => listener();
      listeners.add(subscription);
      if (!stopChanges) {
        try { stopChanges = subscribeChanges(() => { generation += 1; scans.clear(); for (const notify of [...listeners]) notify(); }); }
        catch (error) { listeners.delete(subscription); throw error; }
      }
      return () => {
        listeners.delete(subscription);
        if (!listeners.size && stopChanges) { const stop = stopChanges; stopChanges = undefined; scans.clear(); stop(); }
      };
    },
    scan(asset, fresh = false) {
      const key = JSON.stringify([asset.providerId, asset.assetId]);
      const startedIn = generation;
      const existing = scans.get(key);
      if (!fresh && existing && existing.generation === startedIn) return existing.result;
      const pending = (async (): Promise<AssetUsageScan> => {
      try {
        const graph = await capture();
        if (graph.status !== "ready") return { status: "unavailable", locations: [], tokens: {}, message: graph.message };
        const locations = graph.index.assetUses.filter(({ use }) => use.asset.providerId === asset.providerId && use.asset.assetId === asset.assetId).map(({ location, use }) => {
          const snapshot = graph.snapshots.find(({ providerId }) => providerId === location.entry.providerId)!;
          const model = snapshot.models.find(({ id }) => id === location.entry.modelId)!;
          const entry = snapshot.entries.find(({ id }) => id === location.entry.recordId)!;
          return { providerId: snapshot.providerId, modelId: model.id, entryId: entry.id, fieldId: String(location.path[0]),
            valuePath: location.path.slice(1), modelName: model.document.name, entryTitle: entry.id,
            fieldLabel: model.document.fields.find(({ id }) => id === location.fieldId)?.label ?? location.fieldId, use };
        });
        const inspected = await impact?.read();
        const additionalLocations = inspected?.index.references.filter(({ ref, location }) => ref.providerId === asset.providerId && ref.assetId === asset.assetId && location.selectionPath === undefined).map(({ location }) => ({ location, href: impact?.href?.(location) })) ?? [];
        const complete = graph.index.complete && inspected?.index.complete === true;
        return { status: complete ? "complete" : "incomplete", locations, additionalLocations,
          ...(inspected ? { projectRevision: inspected.revision } : {}),
          tokens: Object.fromEntries(graph.snapshots.map((snapshot) => [snapshot.providerId, snapshot.mutationToken])),
          message: complete ? "Complete managed Assets impact scan across Content, Composition properties, Markdown destinations and route materializations. External/advisory references are not proof of non-use." : `The authoritative Assets impact scan is incomplete; trash is blocked. ${impact ? inspected?.index.advisory.slice(0, 3).map(({ reason }) => reason).join(" ") ?? "Project inspection failed." : "Full-project inspection is unavailable."}` };
      } catch (error) { return { status: "unavailable", locations: [], tokens: {}, message: error instanceof Error ? error.message : "Content scan unavailable." }; }
      })();
      scans.set(key, { generation: startedIn, result: pending });
      void pending.then((result) => {
        const entry = scans.get(key);
        if (entry?.result !== pending) return;
        if (!listeners.size || result.status !== "complete" || entry.generation !== generation) scans.delete(key);
      });
      return pending;
    },
    async isCurrent(scan) {
      if (impact && (!scan.projectRevision || !await impact.isCurrent(scan.projectRevision))) return false;
      if (scan.status !== "complete" || Object.keys(scan.tokens).length !== stores.length) return false;
      try { return (await Promise.all(stores.map(async (store) => { const snapshot = await store.readAll(); return snapshot.providerId === store.provider.id && snapshot.mutationToken === scan.tokens[store.provider.id]; }))).every(Boolean); }
      catch { return false; }
    },
    async targets() {
      const graph = await capture();
      if (graph.status !== "ready" || !graph.index.complete) throw new Error("A complete Content graph is required for insertion.");
      const targets: AssetInsertionTarget[] = [];
      for (const snapshot of graph.snapshots.filter((snapshot) => stores.some((store) => store.provider.id === snapshot.providerId && store.transactionScope === "provider"))) for (const entry of snapshot.entries) {
        const model = snapshot.models.find(({ id }) => id === entry.modelId)!;
        const walk = (schema: ContentValueSchema, value: JsonValue | undefined, field: ContentFieldDefinition, path: (string | number)[]) => {
          if (schema.kind === "asset-use" || (schema.kind === "list" && schema.item.kind === "asset-use")) {
            targets.push({ providerId: snapshot.providerId, modelId: model.id, entryId: entry.id, fieldId: field.id, valuePath: path,
              modelName: model.document.name, entryTitle: entry.id, fieldLabel: field.label, kind: schema.kind === "asset-use" ? schema.use : (schema.item as { use: AssetUse["kind"] }).use,
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
      const matches = target.append ? schema.kind === "list" && schema.item.kind === "asset-use" && schema.item.use === value.kind : schema.kind === "asset-use" && schema.use === value.kind;
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
      scans.clear();
    },
  };
}
