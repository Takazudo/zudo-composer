import { mediaAuthoringUrl, mediaPinKey, mediaVersionUrl, validateMediaAssetRef, validateMediaVersionRef, validateMediaVersionPin, validateMediaSnapshot, isValidMediaChecksum, type MediaAssetRef, type MediaVersionRef, type MediaVersionPin, type MediaSnapshot } from "../model";
import type { VersionedMediaStore } from "../library";
import { subscribePersistenceChanges } from "../../shared/persistence-generation";

export type ManagedMediaReference = MediaAssetRef | MediaVersionRef;
export type MediaReferenceDiagnostic = { code: "unavailable" | "missing" | "trashed" | "corrupt" | "changed" | "unrecognized"; message: string; ref?: ManagedMediaReference };
export interface LockedMediaPin extends MediaVersionPin { metadataRevision: number; headVersionId: string }
export interface MediaReferenceLock { schemaVersion: 1; providerId: string; mutationToken: string; pins: LockedMediaPin[] }
export type MediaLockOutcome = { status: "ready"; lock: MediaReferenceLock } | { status: "blocked"; diagnostics: MediaReferenceDiagnostic[] };
function pinValue(pin: MediaVersionPin): MediaVersionPin { return { providerId: pin.providerId, assetId: pin.assetId, versionId: pin.versionId, checksum: pin.checksum, mediaType: pin.mediaType, byteLength: pin.byteLength, url: pin.url }; }
export function parseManagedMediaUrl(value: string, providerId = "media-files"): MediaAssetRef | undefined {
  const prefix = "/uploaded-media/asset-";
  if (!value.startsWith(prefix)) return undefined;
  const ref = { providerId, assetId: value.slice(prefix.length) };
  return validateMediaAssetRef(ref) && value === mediaAuthoringUrl(ref.assetId) ? ref : undefined;
}
export function isImmutableMediaUrl(value: string): boolean { return /^\/uploaded-media\/sha256-[a-f0-9]{64}\.(?:png|jpg|gif|webp|pdf)$/.test(value); }
export function validateMediaReferenceLock(value: unknown): value is MediaReferenceLock {
  if (!value || typeof value !== "object" || Object.keys(value).sort().join(",") !== "mutationToken,pins,providerId,schemaVersion") return false;
  const lock = value as MediaReferenceLock;
  if (lock.schemaVersion !== 1 || !validateMediaAssetRef({ providerId: lock.providerId, assetId: "check" }) || !isValidMediaChecksum(lock.mutationToken) || !Array.isArray(lock.pins)) return false;
  const heads = new Map<string, { revision: number; version: string }>();
  return lock.pins.every((entry, index) => {
    if (!entry || Object.keys(entry).sort().join(",") !== "assetId,byteLength,checksum,headVersionId,mediaType,metadataRevision,providerId,url,versionId") return false;
    const { metadataRevision, headVersionId, ...pin } = entry;
    const prior = heads.get(entry.assetId);
    if (prior && (prior.revision !== metadataRevision || prior.version !== headVersionId)) return false;
    heads.set(entry.assetId, { revision: metadataRevision, version: headVersionId });
    return validateMediaVersionPin(pin) && isValidMediaChecksum(headVersionId) && entry.providerId === lock.providerId && Number.isSafeInteger(metadataRevision) && metadataRevision > 0 && (index === 0 || mediaPinKey(lock.pins[index - 1]!) < mediaPinKey(pin));
  });
}
export function resolvePinnedMedia(ref: ManagedMediaReference, lock: MediaReferenceLock): MediaVersionPin | undefined {
  if ((!validateMediaAssetRef(ref) && !validateMediaVersionRef(ref)) || !validateMediaReferenceLock(lock)) return undefined;
  const matches = lock.pins.filter((pin) => pin.providerId === ref.providerId && pin.assetId === ref.assetId && ("versionId" in ref ? pin.versionId === ref.versionId : pin.versionId === pin.headVersionId));
  if (matches.length !== 1) return undefined;
  return pinValue(matches[0]!);
}
export async function createMediaReferenceLock(store: VersionedMediaStore | undefined, refs: readonly ManagedMediaReference[], suppliedSnapshot?: MediaSnapshot): Promise<MediaLockOutcome> {
  if (!store) return { status: "blocked", diagnostics: [{ code: "unavailable", message: "The Media provider is unavailable." }] };
  try {
    const snapshot = structuredClone(suppliedSnapshot ?? await store.snapshot());
    if (!validateMediaSnapshot(snapshot)) return { status: "blocked", diagnostics: [{ code: "corrupt", message: "Media snapshot is invalid." }] };
    const diagnostics: MediaReferenceDiagnostic[] = [], pins = new Map<string, LockedMediaPin>();
    for (const ref of refs) {
      if ((!validateMediaAssetRef(ref) && !validateMediaVersionRef(ref)) || ref.providerId !== store.provider.id) { diagnostics.push({ code: "missing", ref, message: "Media reference provider or identity is unavailable." }); continue; }
      const record = snapshot.records.find(({ id }) => id === ref.assetId);
      if (!record) { diagnostics.push({ code: "missing", ref, message: "Required Media asset is missing." }); continue; }
      if (record.document.state !== "active") { diagnostics.push({ code: "trashed", ref, message: "Required Media asset is in trash." }); continue; }
      const versionId = "versionId" in ref ? ref.versionId : record.document.currentVersionId;
      const version = record.document.versions.find(({ id }) => id === versionId);
      if (!version) { diagnostics.push({ code: "missing", ref, message: "Required immutable version is missing." }); continue; }
      const exact = { providerId: ref.providerId, assetId: ref.assetId, versionId };
      if (pins.has(mediaPinKey(exact))) continue;
      try {
        const pin = await store.resolveVersion(exact);
        if (!validateMediaVersionPin(pin, exact) || pin.checksum !== version.checksum || pin.mediaType !== version.mediaType || pin.byteLength !== version.byteLength || pin.url !== mediaVersionUrl(versionId, version.mediaType)) throw new Error("Immutable Media metadata disagrees with the captured snapshot.");
        pins.set(mediaPinKey(pin), { ...pin, metadataRevision: record.revision, headVersionId: record.document.currentVersionId });
      } catch (error) { diagnostics.push({ code: "corrupt", ref, message: error instanceof Error ? error.message : "Media bytes could not be verified." }); }
    }
    if (await store.mutationToken() !== snapshot.mutationToken) diagnostics.push({ code: "changed", message: "Media metadata changed while exact versions were being captured." });
    return diagnostics.length ? { status: "blocked", diagnostics } : { status: "ready", lock: { schemaVersion: 1, providerId: store.provider.id, mutationToken: snapshot.mutationToken, pins: [...pins].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, pin]) => pin) } };
  } catch (error) { return { status: "blocked", diagnostics: [{ code: "unavailable", message: error instanceof Error ? error.message : "Media capture failed." }] }; }
}
export async function checkMediaLockPreconditions(lock: MediaReferenceLock, store: VersionedMediaStore): Promise<boolean> {
  if (!validateMediaReferenceLock(lock) || store.provider.id !== lock.providerId) return false;
  try {
    const snapshot = await store.snapshot();
    return validateMediaSnapshot(snapshot) && snapshot.mutationToken === lock.mutationToken && lock.pins.every((pin) => snapshot.records.some((record) => record.id === pin.assetId && record.revision === pin.metadataRevision && record.document.state === "active" && record.document.currentVersionId === pin.headVersionId && record.document.versions.some((version) => version.id === pin.versionId && version.mediaType === pin.mediaType && version.byteLength === pin.byteLength && version.url === pin.url)));
  } catch { return false; }
}
export function serializeMediaReferenceLock(lock: MediaReferenceLock): string {
  if (!validateMediaReferenceLock(lock)) throw new TypeError("Invalid exact-version Media lock.");
  const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}` : JSON.stringify(value);
  return `${canonical(lock)}\n`;
}
/** Historical verification never asks for a mutable head or metadata snapshot. */
export async function verifyMediaLockIntegrity(lock: MediaReferenceLock, store: Pick<VersionedMediaStore, "resolveVersion">): Promise<boolean> {
  if (!validateMediaReferenceLock(lock)) return false;
  try { for (const entry of lock.pins) {
    const pin = pinValue(entry);
    const verified = await store.resolveVersion({ providerId: pin.providerId, assetId: pin.assetId, versionId: pin.versionId });
    if (!validateMediaVersionPin(verified, { providerId: pin.providerId, assetId: pin.assetId, versionId: pin.versionId }) || verified.url !== pin.url || verified.mediaType !== pin.mediaType || verified.byteLength !== pin.byteLength) return false;
  } return true; } catch { return false; }
}
export class LiveMediaReferenceResolver {
  private listeners = new Set<() => void>(); private stop?: () => void;
  private pending = new Map<string, Promise<MediaLockOutcome>>(); private generation = 0;
  constructor(readonly store: VersionedMediaStore | undefined, private subscribe = (listener: () => void) => subscribePersistenceChanges((database) => { if (database === "media") listener(); })) {}
  subscribeChanges(listener: () => void): () => void {
    const subscription = () => listener(); this.listeners.add(subscription);
    this.stop ??= this.subscribe(() => { this.generation++; this.pending.clear(); for (const notify of this.listeners) { try { notify(); } catch { /* One observer cannot prevent other previews invalidating. */ } } });
    return () => { this.listeners.delete(subscription); if (!this.listeners.size) { this.stop?.(); this.stop = undefined; this.pending.clear(); } };
  }
  resolve(refs: readonly ManagedMediaReference[]): Promise<MediaLockOutcome> {
    const key = JSON.stringify(refs), prior = this.pending.get(key); if (prior) return prior;
    const generation = this.generation;
    const pending = createMediaReferenceLock(this.store, refs).then((result): MediaLockOutcome => generation === this.generation ? result : { status: "blocked", diagnostics: [{ code: "changed", message: "Media changed during draft resolution." }] });
    this.pending.set(key, pending);
    void pending.then((result) => { if ((!this.listeners.size || result.status === "blocked") && this.pending.get(key) === pending) this.pending.delete(key); });
    return pending;
  }
}
