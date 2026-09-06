import type { DevRequest, DevResponse } from "./file-provider-http.mjs";

export const TRANSACTION_OPERATION: "transaction";

export function domainFileProviderEndpoint(domain: string): string;

export interface DomainWireError {
  domain: string;
  operation: string;
  code: string;
  message: string;
  details?: unknown;
}

export function serializeDomainError(
  domain: string,
  cause: unknown,
  fallbackOperation: string,
  isDomainError: (value: unknown) => boolean,
): { status: number; error: DomainWireError };

export interface DomainTransactionRequest {
  expectedMutationToken?: string;
  steps: readonly { operation: string; payload?: unknown }[];
}

export interface DomainFileProviderMiddlewareOptions<Store> {
  domain: string;
  capability: string;
  endpoint?: string;
  maxBodyBytes?: number;
  isDomainError(value: unknown): boolean;
  operations: Record<string, (store: Store, payload: unknown) => Promise<unknown> | unknown>;
  applyTransaction?(store: Store, request: DomainTransactionRequest): Promise<unknown>;
  createStore(): Promise<Store>;
}

export function createDomainFileProviderMiddleware<Store>(
  options: DomainFileProviderMiddlewareOptions<Store>,
): (req: DevRequest) => Promise<DevResponse>;
