import type { MediaInitializationOutcome, MediaProvider, MediaRecord, VersionedMediaStore, MediaMutationPrecondition } from "../../library";

export interface MediaFileProviderConfig {
  mediaEndpoint: string;
  capability: string;
  capabilityHeader: string;
  mediaMaxBodyBytes: number;
  mediaOperationHeader: string;
  mediaFileNameHeader: string;
  mediaRecordIdHeader: string;
  mediaMetadataHeader: string;
}

export interface MediaFileProviderStore extends VersionedMediaStore {
  initialize(): Promise<MediaInitializationOutcome>;
  upload(file: Blob & { name: string }, options?: { folderId?: string | null; note?: string; expectedMutationToken?: string }): Promise<MediaRecord>;
  replace(id: string, file: Blob, precondition: MediaMutationPrecondition): Promise<MediaRecord>;
}

export interface MediaFileProvider extends MediaProvider {
  readonly store: MediaFileProviderStore;
}
