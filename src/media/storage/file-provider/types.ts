import type { MediaProvider, MediaRecord, MediaStore } from "../../library";

export interface MediaFileProviderConfig {
  mediaEndpoint: string;
  capability: string;
  capabilityHeader: string;
  mediaMaxBodyBytes: number;
  mediaOperationHeader: string;
  mediaFileNameHeader: string;
  mediaRecordIdHeader: string;
}

export interface MediaFileProviderStore extends MediaStore {
  upload(file: Blob & { name: string }): Promise<MediaRecord>;
}

export interface MediaFileProvider extends MediaProvider {
  readonly store: MediaFileProviderStore;
}
