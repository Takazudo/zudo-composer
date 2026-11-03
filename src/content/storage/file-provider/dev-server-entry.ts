// Loaded only by the active Vite development server. Keeping this Node-side
// import behind `ssrLoadModule` prevents filesystem modules entering clients.
//
// The plugin graph cannot use `instanceof`, so the domain-error predicate is
// exported from here rather than reimplemented as a duck-type check.
import { ContentPersistenceError } from "../../library";
import { createContentAiService, createNativeContentEditorial, EditorialError, runContentAiOperation, type ContentAiInference, type ContentAiProposalStore, type ContentAiProposer, type ContentAiWireResult } from "../../editorial";
import { openContentAiProposalStore } from "../filesystem/content-ai-proposals";
import type { ContentEntryRecord } from "../../model";
import { createFilesystemContentStore, type FilesystemContentStore } from "../filesystem";
import { workspaceScopedRoot } from "../../../shared/workspace-scope";

/** The local operator owns this single-user dev server; the Content editor is its only writer here. */
const CONTENT_EDITOR_PROVENANCE = { actor: { id: "local-owner" }, source: "content-editor" };

/**
 * The Content root, scoped to one workspace. Directory scoping lives in exactly
 * one module, and it is reached from here rather than from the plugin so the
 * `workspace-v1-` prefix is never spelled a second time in the Vite config
 * graph, which cannot import TypeScript.
 */
export function createWorkspaceScopedContentStore(contentRoot: string, workspaceId: string) {
  return createFilesystemContentStore({ contentRoot: workspaceScopedRoot(contentRoot, workspaceId), revisionProvenance: CONTENT_EDITOR_PROVENANCE });
}
export { CONTENT_FILE_PROVIDER_OPERATIONS } from "./types";

export function isContentPersistenceError(value: unknown): boolean {
  return value instanceof ContentPersistenceError;
}

async function readPublishedFrom(store: FilesystemContentStore, readActivated: ActivatedReader) {
  const active = await readActivated();
  if (!active) return null;
  return {
    release: active.release.identity.buildId,
    fence: await store.activationFence(),
    entries: active.project.providers.content.find((provider) => provider.id === store.provider.id)?.entries ?? [],
  };
}

/**
 * One editorial request from the Content editor. Refusals come back as an
 * `{ok: false}` envelope with their field diagnostics; only storage failures
 * travel as domain errors.
 */
export async function runContentEditorial(
  store: FilesystemContentStore,
  readActivated: () => Promise<{ project: { providers: { content: { id: string; entries: ContentEntryRecord[] }[] } }; release: { identity: { buildId: string } } } | null>,
  operation: string,
  payload: unknown,
): Promise<{ ok: true; value: unknown } | { ok: false; error: { code: string; message: string; diagnostics: unknown[] } }> {
  const boundary = createNativeContentEditorial({
    store,
    provenance: CONTENT_EDITOR_PROVENANCE,
    readPublished: () => readPublishedFrom(store, readActivated),
  });
  const input = (payload ?? {}) as never;
  try {
    switch (operation) {
      case "editorial-read": return { ok: true, value: await boundary.readEntry(input) };
      case "editorial-fields": return { ok: true, value: await boundary.readFields(input) };
      case "editorial-revisions": return { ok: true, value: await boundary.listRevisions(input) };
      case "editorial-revision": return { ok: true, value: await boundary.readRevision(input) };
      case "editorial-compare": return { ok: true, value: await boundary.compare(input) };
      case "editorial-validate": return { ok: true, value: await boundary.validateFields(input) };
      case "editorial-save": return { ok: true, value: await boundary.saveFields(input) };
      case "editorial-restore": return { ok: true, value: await boundary.restoreRevision(input) };
      case "editorial-publication": return { ok: true, value: await boundary.publicationStatus() };
      case "editorial-operation": return { ok: true, value: await boundary.readOperation(input) };
      default: throw new EditorialError("invalid-request", "Unknown editorial operation.");
    }
  } catch (error) {
    if (!(error instanceof EditorialError)) throw error;
    return { ok: false, error: { code: error.code, message: error.message, diagnostics: error.diagnostics } };
  }
}

type ActivatedReader = Parameters<typeof runContentEditorial>[1];
const proposalStores = new Map<string, Promise<ContentAiProposalStore>>();

/** The host's configured Content-AI provider, as the plugin resolves it from the Assistant config. */
export interface NativeContentAiHost {
  provider: { label: string; proposer: ContentAiProposer; inference(): Promise<ContentAiInference> };
  canApply: boolean;
  proposalRoot: string;
}

/**
 * One Content-AI request from the Content editor. The proposer comes from the
 * host's configured Assistant provider; without one, Content-AI is unavailable.
 * Proposals are recorded under the host's private data directory, so Apply and
 * Undo stay recoverable across a restart, including while inference is down.
 */
export async function runContentAi(
  store: FilesystemContentStore,
  readActivated: ActivatedReader,
  host: () => Promise<NativeContentAiHost | null>,
  operation: string,
  payload: unknown,
): Promise<ContentAiWireResult> {
  const configured = await host();
  return runContentAiOperation({
    status: async () => configured
      ? { configured: true, provider: configured.provider.label, canApply: configured.canApply, inference: await configured.provider.inference() }
      : { configured: false },
    async service() {
      if (!configured) throw new EditorialError("configuration-required", "Content-AI needs an Assistant provider in zudo-composer.config.ts.");
      let proposals = proposalStores.get(configured.proposalRoot);
      if (!proposals) proposalStores.set(configured.proposalRoot, proposals = openContentAiProposalStore(configured.proposalRoot));
      return createContentAiService({
        boundary: (provenance) => createNativeContentEditorial({ store, provenance, readPublished: () => readPublishedFrom(store, readActivated) }),
        actor: CONTENT_EDITOR_PROVENANCE.actor,
        owner: `native:${store.root}`,
        proposer: configured.provider.proposer,
        store: await proposals,
        createId: () => globalThis.crypto.randomUUID(),
        canApply: configured.canApply,
      });
    },
  }, operation, payload);
}
