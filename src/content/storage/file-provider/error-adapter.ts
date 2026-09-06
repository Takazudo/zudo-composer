// The per-domain half of the transport: how a ContentPersistenceError becomes a
// wire payload and how it comes back.
//
// The point of the round trip is that the browser keeps the exact error it
// would have received in-process — same operation, same code, same retryable
// flag — instead of a flattened message it can only display. `retryable` is not
// derivable from the code alone (a `validation` raised while a transaction was
// aborted is not the same as one raised by a malformed record), so it travels
// as structured details rather than being guessed at either end.

import {
  ContentPersistenceError,
  isContentPersistenceErrorCode,
  isContentPersistenceOperation,
} from "../../library";
import type { FileProviderErrorAdapter, FileProviderWireError } from "../../../shared/file-provider";
import { CONTENT_FILE_PROVIDER_DOMAIN, contentPersistenceOperationOf } from "./types";
import type { ContentWireOperation } from "./types";

interface ContentWireDetails { retryable: boolean }

function isContentWireDetails(value: unknown): value is ContentWireDetails {
  return typeof value === "object" && value !== null
    && Object.keys(value).length === 1
    && typeof (value as ContentWireDetails).retryable === "boolean";
}

export const contentFileProviderErrorAdapter: FileProviderErrorAdapter<ContentWireOperation, ContentPersistenceError> = {
  domain: CONTENT_FILE_PROVIDER_DOMAIN,
  persistenceChannel: CONTENT_FILE_PROVIDER_DOMAIN,

  isDomainError: (value): value is ContentPersistenceError => value instanceof ContentPersistenceError,

  toWire: (error): FileProviderWireError => ({
    domain: CONTENT_FILE_PROVIDER_DOMAIN,
    operation: error.operation,
    code: error.code,
    message: error.message,
    details: error.details satisfies ContentWireDetails,
  }),

  fromWire: (error, fallbackOperation) => new ContentPersistenceError(
    isContentPersistenceOperation(error.operation) ? error.operation : contentPersistenceOperationOf(fallbackOperation),
    isContentPersistenceErrorCode(error.code) ? error.code : "unknown",
    error.message,
    // A payload without usable details is treated as not retryable: repeating a
    // request whose outcome is unknown is the one thing that must not happen by
    // default.
    isContentWireDetails(error.details) ? error.details.retryable : false,
  ),

  transportError: (operation, message, cause) => new ContentPersistenceError(
    contentPersistenceOperationOf(operation),
    "unavailable",
    message,
    true,
    { cause },
  ),
};
