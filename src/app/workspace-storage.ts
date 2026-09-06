// The workspace registry, as the application sees it.
//
// Durable workspace metadata lives in the host project's files, under
// `<dataDir>/workspaces`. The browser never touches those files: it reaches the
// same registry the dev server runs over one capability-protected same-origin
// endpoint, and every record that comes back is re-validated with the shared
// workspace-record validators before it is believed.
//
// Two things this module owns that the Node registry deliberately does not:
//
//   * **Refresh hints.** `FilesystemWorkspaceRegistry` never calls
//     `notifyPersistenceChange` — there are no browser listeners in a Node
//     process, and a commit that fired one would be lying about who heard it.
//     The hint belongs to the endpoint's browser half, which is here: every
//     mutating call emits on the `workspace` channel, and
//     `persistence-generation`'s BroadcastChannel carries it to the other tabs.
//     Hints are hints; snapshot correctness still rests on persisted tokens.
//   * **Tab serialization.** Seeding is a long browser-driven sequence across
//     four providers. Web Locks release when their tab dies, which is what a
//     lock held across an editing session must do; the dev server's own
//     `O_EXCL` lock — which is never stolen — guards the short registry
//     transitions instead, on the far side of each request.

import { domainProviderConfig } from "virtual:composer-domain-providers";
import { DomainFileProviderClient, readDomainFileProviderConfig } from "../shared/file-provider";
import type { FileProviderConfig, FileProviderErrorAdapter, FileProviderWireError } from "../shared/file-provider";
import { isSafeRecordId } from "../shared";
import type { SiteProject, SiteProjectCollectionAttachment } from "../site-project/model";
import { validateWorkspaceRecord, type WorkspaceRecord } from "./workspace-record";
import {
  WorkspaceRegistryError,
  type WorkspaceRegistryErrorCode,
  type WorkspaceRegistryOperation,
} from "./workspace-filesystem/types";

/** The registry's file-provider domain, and its refresh-hint channel. */
export const WORKSPACE_FILE_PROVIDER_DOMAIN = "workspace";

export interface WorkspaceMetadataPatch {
  name?: string;
  activeSitemap?: SiteProject["activeSitemap"];
  baselineRevision?: string;
  collectionAttachments?: readonly SiteProjectCollectionAttachment[];
}

/**
 * The registry surface the application depends on.
 *
 * The dev server's `createWorkspaceRegistryService` implements it directly, so
 * a spec can drive the real filesystem registry without a transport while the
 * app drives the same methods over one.
 */
export interface WorkspaceStorage {
  list(): Promise<readonly WorkspaceRecord[]>;
  selection(): Promise<string | null>;
  generation(): Promise<number>;
  /** Without an id, the selected workspace; `null` when none is selected. */
  open(id?: string): Promise<WorkspaceRecord | null>;
  findSeeding(project: SiteProject, revision: string): Promise<WorkspaceRecord | null>;
  create(project: SiteProject, baselineRevision: string, id?: string, requiresBeforeComplete?: boolean): Promise<WorkspaceRecord>;
  markSeedCleanup(id: string, revision: string): Promise<void>;
  discardSeeding(id: string, revision: string): Promise<void>;
  complete(id: string, creationValidated?: boolean): Promise<WorkspaceRecord>;
  update(id: string, expectedToken: number, patch: WorkspaceMetadataPatch): Promise<WorkspaceRecord>;
  /** The counterpart of seed cleanup: remove every directory this workspace owns. */
  deleteDirectories(id: string): Promise<void>;
  /** Which of the four authoring directories are absent. */
  missingDirectories(id: string): Promise<readonly string[]>;
}

type WorkspaceWireOperation =
  | "list"
  | "selection"
  | "generation"
  | "open"
  | "find-seeding"
  | "create"
  | "mark-seed-cleanup"
  | "discard-seeding"
  | "complete"
  | "update"
  | "delete-directories"
  | "missing-directories";

const OPERATIONS: readonly WorkspaceRegistryOperation[] = ["initialize", "read", "create", "complete", "update", "discard", "select"];
const CODES: readonly WorkspaceRegistryErrorCode[] = ["blocked", "read-failed", "write-failed", "conflict", "commit-uncertain", "validation", "unsupported-version"];

/**
 * The registry classifies retryability from the code alone — the same rule its
 * own error factory applies — so nothing has to travel as structured details.
 */
function retryableCode(code: WorkspaceRegistryErrorCode): boolean {
  return code === "read-failed" || code === "write-failed" || code === "conflict";
}

function registryOperation(value: string, fallback: WorkspaceRegistryOperation): WorkspaceRegistryOperation {
  return OPERATIONS.includes(value as WorkspaceRegistryOperation) ? value as WorkspaceRegistryOperation : fallback;
}

/** A wire operation named for the browser maps onto the registry's own vocabulary. */
function registryOperationOf(operation: WorkspaceWireOperation): WorkspaceRegistryOperation {
  switch (operation) {
    case "create": return "create";
    case "complete": return "complete";
    case "update": return "update";
    case "mark-seed-cleanup":
    case "discard-seeding":
    case "delete-directories": return "discard";
    default: return "read";
  }
}

export const workspaceFileProviderErrorAdapter: FileProviderErrorAdapter<WorkspaceWireOperation, WorkspaceRegistryError> = {
  domain: WORKSPACE_FILE_PROVIDER_DOMAIN,
  persistenceChannel: WORKSPACE_FILE_PROVIDER_DOMAIN,

  isDomainError: (value): value is WorkspaceRegistryError => value instanceof WorkspaceRegistryError,

  toWire: (error): FileProviderWireError => ({
    domain: WORKSPACE_FILE_PROVIDER_DOMAIN,
    operation: error.operation,
    code: error.code,
    message: error.message,
  }),

  fromWire: (error, fallbackOperation) => {
    const code = CODES.includes(error.code as WorkspaceRegistryErrorCode) ? error.code as WorkspaceRegistryErrorCode : "blocked";
    return new WorkspaceRegistryError(
      registryOperation(error.operation, registryOperationOf(fallbackOperation)),
      code,
      error.message,
      retryableCode(code),
    );
  },

  transportError: (operation, message, cause) => new WorkspaceRegistryError(
    registryOperationOf(operation),
    "read-failed",
    message,
    true,
    { cause },
  ),
};

function decodeRecord(value: unknown): WorkspaceRecord {
  return validateWorkspaceRecord(value, (message) => {
    throw new WorkspaceRegistryError("read", "blocked", `The local workspace registry returned an invalid record: ${message}`, false);
  });
}

function decodeOptionalRecord(value: unknown): WorkspaceRecord | null {
  return value === null || value === undefined ? null : decodeRecord(value);
}

export interface CreateFileProviderWorkspaceStorageOptions {
  config: FileProviderConfig;
  fetchImpl?: typeof fetch;
}

class FileProviderWorkspaceStorage implements WorkspaceStorage {
  private readonly client: DomainFileProviderClient<WorkspaceWireOperation, WorkspaceRegistryError>;

  constructor(options: CreateFileProviderWorkspaceStorageOptions) {
    this.client = new DomainFileProviderClient(
      options.config,
      workspaceFileProviderErrorAdapter,
      options.fetchImpl ?? globalThis.fetch.bind(globalThis),
    );
  }

  async list(): Promise<readonly WorkspaceRecord[]> {
    const records = await this.client.call<unknown>("list");
    if (!Array.isArray(records)) throw this.malformed("read", "a malformed workspace list");
    return records.map(decodeRecord);
  }

  async selection(): Promise<string | null> {
    const value = await this.client.call<unknown>("selection");
    if (value !== null && !isSafeRecordId(value)) throw this.malformed("read", "a malformed workspace selection");
    return value as string | null;
  }

  async generation(): Promise<number> {
    const value = await this.client.call<unknown>("generation");
    if (!Number.isSafeInteger(value) || (value as number) < 0) throw this.malformed("read", "a malformed registry generation");
    return value as number;
  }

  async open(id?: string): Promise<WorkspaceRecord | null> {
    return decodeOptionalRecord(await this.client.call("open", id === undefined ? {} : { id }));
  }

  async findSeeding(project: SiteProject, revision: string): Promise<WorkspaceRecord | null> {
    return decodeOptionalRecord(await this.client.call("find-seeding", { project, revision }));
  }

  async create(project: SiteProject, baselineRevision: string, id?: string, requiresBeforeComplete = false): Promise<WorkspaceRecord> {
    return decodeRecord(await this.client.call(
      "create",
      { project, baselineRevision, ...(id === undefined ? {} : { id }), requiresBeforeComplete },
      { mutates: true },
    ));
  }

  async markSeedCleanup(id: string, revision: string): Promise<void> {
    await this.client.call("mark-seed-cleanup", { id, revision }, { mutates: true });
  }

  async discardSeeding(id: string, revision: string): Promise<void> {
    await this.client.call("discard-seeding", { id, revision }, { mutates: true });
  }

  async complete(id: string, creationValidated = false): Promise<WorkspaceRecord> {
    return decodeRecord(await this.client.call("complete", { id, creationValidated }, { mutates: true }));
  }

  async update(id: string, expectedToken: number, patch: WorkspaceMetadataPatch): Promise<WorkspaceRecord> {
    return decodeRecord(await this.client.call("update", { id, expectedToken, patch }, { mutates: true }));
  }

  async deleteDirectories(id: string): Promise<void> {
    await this.client.call("delete-directories", { id }, { mutates: true });
  }

  async missingDirectories(id: string): Promise<readonly string[]> {
    const value = await this.client.call<unknown>("missing-directories", { id });
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
      throw this.malformed("read", "a malformed directory report");
    }
    return value as readonly string[];
  }

  private malformed(operation: WorkspaceRegistryOperation, detail: string): WorkspaceRegistryError {
    return new WorkspaceRegistryError(operation, "blocked", `The local workspace registry returned ${detail}.`, false);
  }
}

export function readWorkspaceFileProviderConfig(): FileProviderConfig | undefined {
  return readDomainFileProviderConfig(domainProviderConfig, WORKSPACE_FILE_PROVIDER_DOMAIN);
}

/**
 * The registry the development server injected, or `undefined` in a production
 * build. A caller that gets `undefined` has no workspace registry at all and
 * must say so rather than falling back to some other store.
 */
export function createFileProviderWorkspaceStorage(
  options: Partial<CreateFileProviderWorkspaceStorageOptions> = {},
): WorkspaceStorage | undefined {
  const config = options.config ?? readWorkspaceFileProviderConfig();
  if (!config) return undefined;
  return new FileProviderWorkspaceStorage({ config, ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }) });
}

const localLocks = new Map<string, Promise<unknown>>();

/**
 * Serialize once-only multi-provider seeding within this browser.
 *
 * Web Locks cover the realistic contention — two tabs of the same dev server —
 * and release with their tab. The in-process map is the fallback for a
 * non-browser test environment; it serializes within one module instance, which
 * is exactly what a single-process spec needs.
 */
export async function withWorkspaceInitializationLock<T>(id: string, action: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) return navigator.locks.request(`zudo-workspace-seed-${id}`, action);
  const pending = (localLocks.get(id) ?? Promise.resolve()).then(action, action);
  localLocks.set(id, pending);
  try { return await pending; } finally { if (localLocks.get(id) === pending) localLocks.delete(id); }
}
