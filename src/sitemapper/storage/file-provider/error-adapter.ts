// The per-domain half of the transport: how a SitemapPersistenceError becomes
// a wire payload and how it comes back.
//
// The point of the round trip is that the browser keeps the exact error it
// would have received in-process — same operation, same code, same retryable
// flag — instead of a flattened message it can only display.

import {
  SitemapPersistenceError,
  isSitemapPersistenceErrorCode,
  isSitemapPersistenceOperation,
} from "../../library";
import type { FileProviderErrorAdapter, FileProviderWireError } from "../../../shared/file-provider";
import { SITEMAP_FILE_PROVIDER_DOMAIN, sitemapPersistenceOperationOf } from "./types";
import type { SitemapWireOperation } from "./types";

interface SitemapWireDetails { retryable: boolean }

function isSitemapWireDetails(value: unknown): value is SitemapWireDetails {
  return typeof value === "object" && value !== null
    && Object.keys(value).length === 1
    && typeof (value as SitemapWireDetails).retryable === "boolean";
}

export const sitemapFileProviderErrorAdapter: FileProviderErrorAdapter<SitemapWireOperation, SitemapPersistenceError> = {
  domain: SITEMAP_FILE_PROVIDER_DOMAIN,
  persistenceChannel: SITEMAP_FILE_PROVIDER_DOMAIN,

  isDomainError: (value): value is SitemapPersistenceError => value instanceof SitemapPersistenceError,

  toWire: (error): FileProviderWireError => ({
    domain: SITEMAP_FILE_PROVIDER_DOMAIN,
    operation: error.operation,
    code: error.code,
    message: error.message,
    details: error.details satisfies SitemapWireDetails,
  }),

  fromWire: (error, fallbackOperation) => new SitemapPersistenceError(
    isSitemapPersistenceOperation(error.operation) ? error.operation : sitemapPersistenceOperationOf(fallbackOperation),
    isSitemapPersistenceErrorCode(error.code) ? error.code : "unknown",
    error.message,
    // A payload without usable details is treated as not retryable: repeating a
    // request whose outcome is unknown is the one thing that must not happen by
    // default.
    isSitemapWireDetails(error.details) ? error.details.retryable : false,
  ),

  transportError: (operation, message, cause) => new SitemapPersistenceError(
    sitemapPersistenceOperationOf(operation),
    "unavailable",
    message,
    true,
    { cause },
  ),
};
