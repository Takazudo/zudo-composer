import { ASSET_CHECKSUM_URL_PATTERN, assetAuthoringUrl, assetPinKey, assetVersionUrl, validateAssetAssetRef, validateAssetVersionRef, validateAssetVersionPin, validateAssetSnapshot, isValidAssetChecksum, type AssetAssetRef, type AssetVersionRef, type AssetVersionPin, type AssetSnapshot } from "../model";
import type { VersionedAssetStore } from "../library";
import { subscribePersistenceChanges } from "../../shared/persistence-generation";

export type ManagedAssetReference = AssetAssetRef | AssetVersionRef;
export type AssetReferenceDiagnostic = { code: "unavailable" | "missing" | "trashed" | "corrupt" | "changed" | "unrecognized"; message: string; ref?: ManagedAssetReference };
export interface LockedAssetPin extends AssetVersionPin { metadataRevision: number; headVersionId: string }
export interface AssetReferenceLock { schemaVersion: 1; providerId: string; mutationToken: string; pins: LockedAssetPin[] }
export type AssetLockOutcome = { status: "ready"; lock: AssetReferenceLock } | { status: "blocked"; diagnostics: AssetReferenceDiagnostic[] };
function pinValue(pin: AssetVersionPin): AssetVersionPin { return { providerId: pin.providerId, assetId: pin.assetId, versionId: pin.versionId, checksum: pin.checksum, mimeType: pin.mimeType, byteLength: pin.byteLength, url: pin.url }; }
export function parseManagedAssetUrl(value: string, providerId = "asset-files"): AssetAssetRef | undefined {
  const prefix = "/uploaded-assets/asset-";
  if (!value.startsWith(prefix)) return undefined;
  const ref = { providerId, assetId: value.slice(prefix.length) };
  return validateAssetAssetRef(ref) && value === assetAuthoringUrl(ref.assetId) ? ref : undefined;
}
export function isImmutableAssetUrl(value: string): boolean { return ASSET_CHECKSUM_URL_PATTERN.test(value); }
export function validateAssetReferenceLock(value: unknown): value is AssetReferenceLock {
  if (!value || typeof value !== "object" || Object.keys(value).sort().join(",") !== "mutationToken,pins,providerId,schemaVersion") return false;
  const lock = value as AssetReferenceLock;
  if (lock.schemaVersion !== 1 || !validateAssetAssetRef({ providerId: lock.providerId, assetId: "check" }) || !isValidAssetChecksum(lock.mutationToken) || !Array.isArray(lock.pins)) return false;
  const heads = new Map<string, { revision: number; version: string }>();
  return lock.pins.every((entry, index) => {
    if (!entry || Object.keys(entry).sort().join(",") !== "assetId,byteLength,checksum,headVersionId,metadataRevision,mimeType,providerId,url,versionId") return false;
    const { metadataRevision, headVersionId, ...pin } = entry;
    const prior = heads.get(entry.assetId);
    if (prior && (prior.revision !== metadataRevision || prior.version !== headVersionId)) return false;
    heads.set(entry.assetId, { revision: metadataRevision, version: headVersionId });
    return validateAssetVersionPin(pin) && isValidAssetChecksum(headVersionId) && entry.providerId === lock.providerId && Number.isSafeInteger(metadataRevision) && metadataRevision > 0 && (index === 0 || assetPinKey(lock.pins[index - 1]!) < assetPinKey(pin));
  });
}
export function resolvePinnedAsset(ref: ManagedAssetReference, lock: AssetReferenceLock): AssetVersionPin | undefined {
  if ((!validateAssetAssetRef(ref) && !validateAssetVersionRef(ref)) || !validateAssetReferenceLock(lock)) return undefined;
  const matches = lock.pins.filter((pin) => pin.providerId === ref.providerId && pin.assetId === ref.assetId && ("versionId" in ref ? pin.versionId === ref.versionId : pin.versionId === pin.headVersionId));
  if (matches.length !== 1) return undefined;
  return pinValue(matches[0]!);
}
export async function createAssetReferenceLock(store: VersionedAssetStore | undefined, refs: readonly ManagedAssetReference[], suppliedSnapshot?: AssetSnapshot): Promise<AssetLockOutcome> {
  if (!store) return { status: "blocked", diagnostics: [{ code: "unavailable", message: "The Assets provider is unavailable." }] };
  try {
    const snapshot = structuredClone(suppliedSnapshot ?? await store.snapshot());
    if (!validateAssetSnapshot(snapshot)) return { status: "blocked", diagnostics: [{ code: "corrupt", message: "Assets snapshot is invalid." }] };
    const diagnostics: AssetReferenceDiagnostic[] = [], pins = new Map<string, LockedAssetPin>();
    for (const ref of refs) {
      if ((!validateAssetAssetRef(ref) && !validateAssetVersionRef(ref)) || ref.providerId !== store.provider.id) { diagnostics.push({ code: "missing", ref, message: "Assets reference provider or identity is unavailable." }); continue; }
      const record = snapshot.records.find(({ id }) => id === ref.assetId);
      if (!record) { diagnostics.push({ code: "missing", ref, message: "Required Assets asset is missing." }); continue; }
      if (record.document.state !== "active") { diagnostics.push({ code: "trashed", ref, message: "Required Assets asset is in trash." }); continue; }
      const versionId = "versionId" in ref ? ref.versionId : record.document.currentVersionId;
      const version = record.document.versions.find(({ id }) => id === versionId);
      if (!version) { diagnostics.push({ code: "missing", ref, message: "Required immutable version is missing." }); continue; }
      const exact = { providerId: ref.providerId, assetId: ref.assetId, versionId };
      if (pins.has(assetPinKey(exact))) continue;
      try {
        const pin = await store.resolveVersion(exact);
        if (!validateAssetVersionPin(pin, exact) || pin.checksum !== version.checksum || pin.mimeType !== version.mimeType || pin.byteLength !== version.byteLength || pin.url !== assetVersionUrl(versionId, version.mimeType)) throw new Error("Immutable Assets metadata disagrees with the captured snapshot.");
        pins.set(assetPinKey(pin), { ...pin, metadataRevision: record.revision, headVersionId: record.document.currentVersionId });
      } catch (error) { diagnostics.push({ code: "corrupt", ref, message: error instanceof Error ? error.message : "Assets bytes could not be verified." }); }
    }
    if (await store.mutationToken() !== snapshot.mutationToken) diagnostics.push({ code: "changed", message: "Assets metadata changed while exact versions were being captured." });
    return diagnostics.length ? { status: "blocked", diagnostics } : { status: "ready", lock: { schemaVersion: 1, providerId: store.provider.id, mutationToken: snapshot.mutationToken, pins: [...pins].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, pin]) => pin) } };
  } catch (error) { return { status: "blocked", diagnostics: [{ code: "unavailable", message: error instanceof Error ? error.message : "Assets capture failed." }] }; }
}
export async function checkAssetLockPreconditions(lock: AssetReferenceLock, store: VersionedAssetStore): Promise<boolean> {
  if (!validateAssetReferenceLock(lock) || store.provider.id !== lock.providerId) return false;
  try {
    const snapshot = await store.snapshot();
    return validateAssetSnapshot(snapshot) && snapshot.mutationToken === lock.mutationToken && lock.pins.every((pin) => snapshot.records.some((record) => record.id === pin.assetId && record.revision === pin.metadataRevision && record.document.state === "active" && record.document.currentVersionId === pin.headVersionId && record.document.versions.some((version) => version.id === pin.versionId && version.mimeType === pin.mimeType && version.byteLength === pin.byteLength && version.url === pin.url)));
  } catch { return false; }
}
export function serializeAssetReferenceLock(lock: AssetReferenceLock): string {
  if (!validateAssetReferenceLock(lock)) throw new TypeError("Invalid exact-version Assets lock.");
  const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}` : JSON.stringify(value);
  return `${canonical(lock)}\n`;
}
/** Historical verification never asks for a mutable head or metadata snapshot. */
export async function verifyAssetLockIntegrity(lock: AssetReferenceLock, store: Pick<VersionedAssetStore, "resolveVersion">): Promise<boolean> {
  if (!validateAssetReferenceLock(lock)) return false;
  try { for (const entry of lock.pins) {
    const pin = pinValue(entry);
    const verified = await store.resolveVersion({ providerId: pin.providerId, assetId: pin.assetId, versionId: pin.versionId });
    if (!validateAssetVersionPin(verified, { providerId: pin.providerId, assetId: pin.assetId, versionId: pin.versionId }) || verified.url !== pin.url || verified.mimeType !== pin.mimeType || verified.byteLength !== pin.byteLength) return false;
  } return true; } catch { return false; }
}
export class LiveAssetReferenceResolver {
  private listeners = new Set<() => void>(); private stop?: () => void;
  private pending = new Map<string, Promise<AssetLockOutcome>>(); private generation = 0;
  constructor(readonly store: VersionedAssetStore | undefined, private subscribe = (listener: () => void) => subscribePersistenceChanges((database) => { if (database === "assets") listener(); })) {}
  subscribeChanges(listener: () => void): () => void {
    const subscription = () => listener(); this.listeners.add(subscription);
    this.stop ??= this.subscribe(() => { this.generation++; this.pending.clear(); for (const notify of this.listeners) { try { notify(); } catch { /* One observer cannot prevent other previews invalidating. */ } } });
    return () => { this.listeners.delete(subscription); if (!this.listeners.size) { this.stop?.(); this.stop = undefined; this.pending.clear(); } };
  }
  resolve(refs: readonly ManagedAssetReference[]): Promise<AssetLockOutcome> {
    const key = JSON.stringify(refs), prior = this.pending.get(key); if (prior) return prior;
    const generation = this.generation;
    const pending = createAssetReferenceLock(this.store, refs).then((result): AssetLockOutcome => generation === this.generation ? result : { status: "blocked", diagnostics: [{ code: "changed", message: "Assets changed during draft resolution." }] });
    this.pending.set(key, pending);
    void pending.then((result) => { if ((!this.listeners.size || result.status === "blocked") && this.pending.get(key) === pending) this.pending.delete(key); });
    return pending;
  }
}
