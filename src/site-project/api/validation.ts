import { isPlainObject, isSafeRecordId } from "../../shared";
import type { ReleaseToolchain, StagedRelease } from "./types";
import { validateAssetReferenceLock } from "../../assets/references";
const exact = (value: Record<string, unknown>, names: string[]) => Object.keys(value).sort().join() === names.sort().join();
const sha = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function validateReleaseToolchain(value: unknown): value is ReleaseToolchain {
  return isPlainObject(value) && exact(value, ["compiler", "componentPack", "packSpecifier", "packSource", "installedPackDigest", "contractDigest"]) && typeof value.compiler === "string" && value.compiler.length > 0 && typeof value.packSpecifier === "string" && value.packSpecifier.length > 0 && typeof value.packSource === "string" && value.packSource.length > 0 && sha(value.installedPackDigest) && sha(value.contractDigest) && isPlainObject(value.componentPack) && exact(value.componentPack, ["packId", "packVersion", "contractVersion"]) && typeof value.componentPack.packId === "string" && value.componentPack.packId.length > 0 && typeof value.componentPack.packVersion === "string" && value.componentPack.packVersion.length > 0 && Number.isSafeInteger(value.componentPack.contractVersion) && Number(value.componentPack.contractVersion) > 0;
}
export function validateStagedRelease(value: unknown): value is StagedRelease {
  if (!isPlainObject(value) || !exact(value, ["schemaVersion", "projectId", "revision", "buildId", "assetLock", "toolchain", "planDigest", "publication"]) || value.schemaVersion !== 2 || !isSafeRecordId(value.projectId) || !sha(value.revision) || !sha(value.buildId) || !sha(value.planDigest) || !validateReleaseToolchain(value.toolchain) || !(value.assetLock === null || validateAssetReferenceLock(value.assetLock)) || !Array.isArray(value.publication)) return false;
  const seen = new Set<string>();
  return value.publication.every((item) => {
    if (!isPlainObject(item) || !exact(item, ["ref", "expectedGeneration", "expectedDigest", "lifecycle"]) || !isPlainObject(item.ref) || !exact(item.ref, ["providerId", "modelId", "recordId"]) || !Object.values(item.ref).every(isSafeRecordId) || !Number.isSafeInteger(item.expectedGeneration) || Number(item.expectedGeneration) < 0 || typeof item.expectedDigest !== "string" || !["published", "draft"].includes(String(item.lifecycle))) return false;
    const key = JSON.stringify([item.ref.providerId, item.ref.modelId, item.ref.recordId]); if (seen.has(key)) return false; seen.add(key); return true;
  });
}
