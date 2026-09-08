import type { Plugin } from "vite";
import type { CompositionRecordValidation } from "../src/composer/library";
import type { CompositionRecord } from "../src/composer/library";
import type { FilesystemCompositionStore } from "../src/composer/storage/filesystem";
import type { FilesystemMediaStore } from "../src/media/storage/filesystem";
import type { IncomingMessage, ServerResponse } from "node:http";
import type * as fs from "node:fs/promises";

export const COMPOSER_FILE_PROVIDER_ENDPOINT: string;
export const COMPOSER_FILE_PROVIDER_CAPABILITY_HEADER: string;
export const COMPOSER_FILE_PROVIDER_WORKSPACE_HEADER: string;
export const COMPOSER_FILE_PROVIDER_MAX_BODY_BYTES: number;
export const COMPOSER_FILE_PROVIDER_ROOT: string;
export const COMPOSITIONS_ROOT_ENV: string;
export const MEDIA_FILE_PROVIDER_ENDPOINT: string;
export const MEDIA_FILE_PROVIDER_OPERATION_HEADER: string;
export const MEDIA_FILE_PROVIDER_FILE_NAME_HEADER: string;
export const MEDIA_FILE_PROVIDER_RECORD_ID_HEADER: string;
export const MEDIA_FILE_PROVIDER_METADATA_HEADER: string;
export const MEDIA_UPLOAD_MAX_BYTES: number;
export const MEDIA_FILE_PROVIDER_ROOT: string;

export function createMediaUploadMiddleware(options: {
  capability: string;
  maxBodyBytes?: number;
  createStore(): Promise<FilesystemMediaStore>;
}): (request: IncomingMessage, response: ServerResponse) => Promise<void>;

export function createMediaFileMiddleware(options: {
  workspaceRoot: string;
  mediaStoreRoot?: string;
  createStore?(): Promise<FilesystemMediaStore>;
  operations?: { lstat?: typeof fs.lstat; open?: typeof fs.open; realpath?: typeof fs.realpath };
}): (request: IncomingMessage, response: ServerResponse, next: () => void) => Promise<void>;

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
    workspaceId: string;
    provideJsx(record: CompositionRecord, request: unknown): string | { status: "generated"; code: string } | { status: "blocked"; reason: string };
  }): Promise<Pick<
    FilesystemCompositionStore,
    "list" | "get" | "put" | "delete" | "clear" | "deleteWithDependencyCheck" | "unpublishWithDependencyCheck" | "saveLifecycleRecord" | "snapshot"
  >>;
}): (request: DevRequest) => Promise<DevResponse>;

export function validateMediaStoreRoot(root: string | undefined): string | undefined;
export function resolveCompositionsRoot(workspaceRoot: string, configured?: string): string;
export default function composerFileProviderPlugin(options?: { mediaStoreRoot?: string; compositionsRoot?: string; workspaceRoot?: string }): Plugin;
