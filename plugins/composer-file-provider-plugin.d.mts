import type { Plugin } from "vite";
import type { CompositionRecordValidation } from "../src/composer/library";
import type { CompositionRecord } from "../src/composer/library";
import type { FilesystemCompositionStore } from "../src/composer/storage/filesystem";

export const COMPOSER_FILE_PROVIDER_ENDPOINT: string;
export const COMPOSER_FILE_PROVIDER_CAPABILITY_HEADER: string;
export const COMPOSER_FILE_PROVIDER_MAX_BODY_BYTES: number;
export const COMPOSER_FILE_PROVIDER_ROOT: string;

export interface DevRequest {
  url?: string;
  method?: string;
  headers: Record<string, string | undefined>;
  protocol?: "http" | "https";
  body?: string;
}

export interface DevResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  bodyEncoding: "utf8";
}

export function createComposerFileProviderMiddleware(options: {
  endpoint?: string;
  capability: string;
  maxBodyBytes?: number;
  validateRecord(value: unknown): CompositionRecordValidation;
  createStore(options: {
    provideJsx(record: CompositionRecord, request: unknown): string | { status: "generated"; code: string } | { status: "blocked"; reason: string };
  }): Promise<Pick<
    FilesystemCompositionStore,
    "list" | "get" | "put" | "delete" | "clear" | "deleteWithDependencyCheck" | "unpublishWithDependencyCheck" | "saveLifecycleRecord"
  >>;
}): (request: DevRequest) => Promise<DevResponse>;

export default function composerFileProviderPlugin(): Plugin;
