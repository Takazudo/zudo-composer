import type { IncomingMessage, ServerResponse } from "node:http";

export interface DevRequest {
  url?: string;
  method?: string;
  protocol?: "http" | "https";
  headers: Record<string, string | undefined>;
  body?: string;
}

export interface DevResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  bodyEncoding: "utf8";
}

export const FILE_PROVIDER_CAPABILITY_HEADER: string;
export const FILE_PROVIDER_OPERATION_HEADER: string;
export const FILE_PROVIDER_WORKSPACE_HEADER: string;
export const FILE_PROVIDER_MAX_BODY_BYTES: number;

export function isSafeWorkspaceHeader(value: unknown): value is string;

export function createDevCapability(): string;
export function domainFileProviderEndpoint(domain: string): string;
export function json(status: number, payload: unknown, headers?: Record<string, string>): DevResponse;
export function errorResponse(
  status: number,
  code: string,
  message: string,
  operation?: string,
  headers?: Record<string, string>,
): DevResponse;
export function isPlainObject(value: unknown): value is Record<string, unknown>;
export function hasExactKeys(value: unknown, required: string[], optional?: string[]): boolean;
export function bodyBytes(body: string | undefined): number;
export function isSameOriginDevRequest(req: DevRequest): boolean;
export function hasCapability(req: DevRequest, expected: string, header?: string): boolean;
export function validateRequestHead(
  req: DevRequest,
  endpoint: string,
  capability: string,
  acceptedAssetTypes?: Set<string>,
  unsupportedAssetTypeMessage?: string,
): DevResponse | undefined;
export function isDeadResponse(req: IncomingMessage, res: ServerResponse): boolean;
export function readBody(req: IncomingMessage, maxBodyBytes: number): Promise<string>;
export function sendConnectResponse(res: ServerResponse, response: DevResponse): void;
export function connectRequestHead(req: IncomingMessage): DevRequest;
