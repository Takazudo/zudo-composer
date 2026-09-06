// The per-domain half of the transport: how a MappingPersistenceError becomes a
// wire payload and how it comes back.
//
// The point of the round trip is that the browser keeps the exact error it
// would have received in-process — same operation, same code, same retryable
// flag — instead of a flattened message it can only display.

import {
  MappingPersistenceError,
  isMappingPersistenceErrorCode,
  isMappingPersistenceOperation,
} from "../../model";
import type { FileProviderErrorAdapter, FileProviderWireError } from "../../../shared/file-provider";
import { MAPPING_FILE_PROVIDER_DOMAIN, mappingPersistenceOperationOf } from "./types";
import type { MappingWireOperation } from "./types";

interface MappingWireDetails { retryable: boolean }

function isMappingWireDetails(value: unknown): value is MappingWireDetails {
  return typeof value === "object" && value !== null
    && Object.keys(value).length === 1
    && typeof (value as MappingWireDetails).retryable === "boolean";
}

export const mappingFileProviderErrorAdapter: FileProviderErrorAdapter<MappingWireOperation, MappingPersistenceError> = {
  domain: MAPPING_FILE_PROVIDER_DOMAIN,
  persistenceChannel: MAPPING_FILE_PROVIDER_DOMAIN,

  isDomainError: (value): value is MappingPersistenceError => value instanceof MappingPersistenceError,

  toWire: (error): FileProviderWireError => ({
    domain: MAPPING_FILE_PROVIDER_DOMAIN,
    operation: error.operation,
    code: error.code,
    message: error.message,
    details: error.details satisfies MappingWireDetails,
  }),

  fromWire: (error, fallbackOperation) => new MappingPersistenceError(
    isMappingPersistenceOperation(error.operation) ? error.operation : mappingPersistenceOperationOf(fallbackOperation),
    isMappingPersistenceErrorCode(error.code) ? error.code : "unknown",
    error.message,
    // A payload without usable details is treated as not retryable: repeating a
    // request whose outcome is unknown is the one thing that must not happen by
    // default.
    isMappingWireDetails(error.details) ? error.details.retryable : false,
  ),

  transportError: (operation, message, cause) => new MappingPersistenceError(
    mappingPersistenceOperationOf(operation),
    "unavailable",
    message,
    true,
    { cause },
  ),
};
