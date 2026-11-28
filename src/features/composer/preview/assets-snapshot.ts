import { computed, signal, type ReadonlySignal, type Scope } from "@takazudo/zfb/zudo-react";
import { read, type MaybeSignal } from "../../../components/reactive";
import type { ComponentCatalog } from "../../../composer/model/types";
import type { VersionedAssetStore } from "../../../assets/library";
import { LiveAssetReferenceResolver } from "../../../assets/references";
import { resolveCompositionAsset } from "../../../site-project/assets/impact";
import type { ComposerPreviewSnapshot } from "./protocol";

const resolvers = new WeakMap<VersionedAssetStore, LiveAssetReferenceResolver>();
function resolverFor(store: VersionedAssetStore | undefined) {
  if (!store) return new LiveAssetReferenceResolver(undefined);
  let resolver = resolvers.get(store); if (!resolver) { resolver = new LiveAssetReferenceResolver(store); resolvers.set(store, resolver); } return resolver;
}
export async function resolvePreviewAssetSnapshot(snapshot: ComposerPreviewSnapshot, catalog: ComponentCatalog, resolver: LiveAssetReferenceResolver) {
  const identity = { providerId: resolver.store?.provider.id, preservePinnedUrls: true };
  const local = resolveCompositionAsset(snapshot.document, catalog, identity);
  const linked = snapshot.linked ? resolveCompositionAsset(snapshot.linked.sourceDocument, catalog, identity) : undefined;
  if (!local.index.complete || linked?.index.complete === false) return { status: "blocked" as const, message: "Asset inspection is incomplete. " + [...local.index.advisory, ...(linked?.index.advisory ?? [])].map(({ reason }) => reason).join(" ") };
  const refs = [...local.index.references, ...(linked?.index.references ?? [])].map(({ ref }) => ref);
  if (!refs.length) return { status: "ready" as const, snapshot };
  const result = await resolver.resolve(refs);
  if (result.status === "blocked") return { status: "blocked" as const, message: result.diagnostics.map(({ message }) => message).join(" ") };
  return { status: "ready" as const, snapshot: { ...snapshot, document: resolveCompositionAsset(snapshot.document, catalog, { lock: result.lock }).document,
    ...(snapshot.linked ? { linked: { ...snapshot.linked, sourceDocument: resolveCompositionAsset(snapshot.linked.sourceDocument, catalog, { lock: result.lock }).document } } : {}) } };
}
export interface AssetResolvedPreviewSnapshot {
  snapshot: ComposerPreviewSnapshot | null;
  loading: boolean;
  error?: string;
}

export interface AssetResolvedPreviewOptions {
  /** The workspace's versioned Asset store; without one only pinned URLs pass. */
  store?: VersionedAssetStore;
  enabled?: MaybeSignal<boolean>;
}

/**
 * Resolution runs in the owning host. The iframe receives only detached JSON.
 * The result follows `snapshot` and Asset replacements for `scope`'s lifetime.
 */
export function assetResolvedPreviewSnapshot(
  scope: Scope,
  snapshot: ReadonlySignal<ComposerPreviewSnapshot | null>,
  catalog: ComponentCatalog,
  options: AssetResolvedPreviewOptions = {},
): ReadonlySignal<AssetResolvedPreviewSnapshot> {
  const { store } = options;
  const resolver = resolverFor(store);
  const generation = signal(0);
  const hasManaged = computed(() => {
    const current = snapshot.value;
    if (!read(options.enabled ?? true) || !current) return false;
    const identity = { providerId: store?.provider.id, preservePinnedUrls: true };
    const indices = [resolveCompositionAsset(current.document, catalog, identity).index, ...(current.linked ? [resolveCompositionAsset(current.linked.sourceDocument, catalog, identity).index] : [])];
    return indices.some((index) => !index.complete || index.references.length > 0);
  });
  const resolved = signal<{ source: ComposerPreviewSnapshot; generation: number; value: ComposerPreviewSnapshot | null; error?: string } | null>(null);

  let subscribed = false;
  scope.effect(() => {
    const managed = hasManaged.value;
    if (managed === subscribed) return undefined;
    subscribed = managed;
    if (!managed) return undefined;
    const stop = resolver.subscribeChanges(() => { generation.value += 1; });
    return () => { subscribed = false; stop(); };
  });

  let requested: { source: ComposerPreviewSnapshot; generation: number } | null = null;
  scope.effect(() => {
    const current = snapshot.value;
    const currentGeneration = generation.value;
    if (!current || !hasManaged.value) { requested = null; return; }
    if (requested?.source === current && requested.generation === currentGeneration) return;
    const request = { source: current, generation: currentGeneration };
    requested = request;
    const settle = (value: ComposerPreviewSnapshot | null, error?: string): void => {
      if (scope.abortSignal.aborted || requested !== request) return;
      resolved.value = { source: current, generation: currentGeneration, value, ...(error === undefined ? {} : { error }) };
    };
    void resolvePreviewAssetSnapshot(current, catalog, resolver).then(
      (result) => settle(result.status === "ready" ? result.snapshot : null, result.status === "blocked" ? result.message : undefined),
      (reason: unknown) => settle(null, reason instanceof Error ? reason.message : "Preview assets could not be resolved."),
    );
  });

  return computed(() => {
    const current = snapshot.value;
    if (!hasManaged.value) return { snapshot: current, loading: false, error: undefined };
    const result = resolved.value;
    const latest = result?.source === current && result.generation === generation.value ? result : null;
    return { snapshot: latest?.value ?? null, loading: !latest, error: latest?.error };
  });
}
