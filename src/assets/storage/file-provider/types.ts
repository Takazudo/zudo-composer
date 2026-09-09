import type { AssetInitializationOutcome, AssetProvider, AssetRecord, VersionedAssetStore, AssetMutationPrecondition } from "../../library";

export interface AssetFileProviderConfig {
  assetEndpoint: string;
  capability: string;
  capabilityHeader: string;
  assetMaxBodyBytes: number;
  assetOperationHeader: string;
  assetFileNameHeader: string;
  assetRecordIdHeader: string;
  assetMetadataHeader: string;
}

export interface AssetFileProviderStore extends VersionedAssetStore {
  initialize(): Promise<AssetInitializationOutcome>;
  upload(file: Blob & { name: string }, options?: { folderId?: string | null; note?: string; expectedMutationToken?: string }): Promise<AssetRecord>;
  replace(id: string, file: Blob, precondition: AssetMutationPrecondition): Promise<AssetRecord>;
}

export interface AssetFileProvider extends AssetProvider {
  readonly store: AssetFileProviderStore;
}
