import { useEffect, useMemo, useState } from "preact/hooks";
import { useWorkspace } from "../../../app/workspace-context";
import type { ComponentCatalog } from "../../../composer/model/types";
import type { VersionedMediaStore } from "../../../media/library";
import { LiveMediaReferenceResolver } from "../../../media/references";
import { resolveCompositionMedia } from "../../../site-project/media/impact";
import type { ComposerPreviewSnapshot } from "./protocol";

const resolvers = new WeakMap<VersionedMediaStore, LiveMediaReferenceResolver>();
function resolverFor(store: VersionedMediaStore | undefined) {
  if (!store) return new LiveMediaReferenceResolver(undefined);
  let resolver = resolvers.get(store); if (!resolver) { resolver = new LiveMediaReferenceResolver(store); resolvers.set(store, resolver); } return resolver;
}
export async function resolvePreviewMediaSnapshot(snapshot: ComposerPreviewSnapshot, catalog: ComponentCatalog, resolver: LiveMediaReferenceResolver) {
  const identity = { providerId: resolver.store?.provider.id, preservePinnedUrls: true };
  const local = resolveCompositionMedia(snapshot.document, catalog, identity);
  const linked = snapshot.linked ? resolveCompositionMedia(snapshot.linked.sourceDocument, catalog, identity) : undefined;
  if (!local.index.complete || linked?.index.complete === false) return { status: "blocked" as const, message: "Media inspection is incomplete. " + [...local.index.advisory, ...(linked?.index.advisory ?? [])].map(({ reason }) => reason).join(" ") };
  const refs = [...local.index.references, ...(linked?.index.references ?? [])].map(({ ref }) => ref);
  if (!refs.length) return { status: "ready" as const, snapshot };
  const result = await resolver.resolve(refs);
  if (result.status === "blocked") return { status: "blocked" as const, message: result.diagnostics.map(({ message }) => message).join(" ") };
  return { status: "ready" as const, snapshot: { ...snapshot, document: resolveCompositionMedia(snapshot.document, catalog, { lock: result.lock }).document,
    ...(snapshot.linked ? { linked: { ...snapshot.linked, sourceDocument: resolveCompositionMedia(snapshot.linked.sourceDocument, catalog, { lock: result.lock }).document } } : {}) } };
}
/** Resolution runs in the owning host. The iframe receives only detached JSON. */
export function useMediaResolvedPreviewSnapshot(snapshot: ComposerPreviewSnapshot | null, catalog: ComponentCatalog, enabled = true) {
  const store = useWorkspace()?.integration.mediaProvider?.store;
  const resolver = useMemo(() => resolverFor(store), [store]);
  const [generation, setGeneration] = useState(0);
  const hasManaged = useMemo(() => {
    if (!enabled || !snapshot) return false;
    const identity = { providerId: store?.provider.id, preservePinnedUrls: true };
    const indices = [resolveCompositionMedia(snapshot.document, catalog, identity).index, ...(snapshot.linked ? [resolveCompositionMedia(snapshot.linked.sourceDocument, catalog, identity).index] : [])];
    return indices.some((index) => !index.complete || index.references.length > 0);
  }, [snapshot, catalog, enabled, store]);
  const [resolved, setResolved] = useState<{ source: ComposerPreviewSnapshot; generation: number; value: ComposerPreviewSnapshot | null; error?: string } | null>(null);
  useEffect(() => hasManaged ? resolver.subscribeChanges(() => { setGeneration((value) => value + 1); }) : undefined, [resolver, hasManaged]);
  useEffect(() => {
    if (!snapshot || !hasManaged) return;
    let active = true;
    void resolvePreviewMediaSnapshot(snapshot, catalog, resolver).then((result) => { if (active) setResolved({ source: snapshot, generation, value: result.status === "ready" ? result.snapshot : null, ...(result.status === "blocked" ? { error: result.message } : {}) }); });
    return () => { active = false; };
  }, [snapshot, catalog, resolver, generation, hasManaged]);
  if (!hasManaged) return { snapshot, loading: false, error: undefined };
  const current = resolved?.source === snapshot && resolved.generation === generation ? resolved : null;
  return { snapshot: current?.value ?? null, loading: !current, error: current?.error };
}
