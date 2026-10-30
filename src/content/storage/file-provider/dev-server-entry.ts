// Loaded only by the active Vite development server. Keeping this Node-side
// import behind `ssrLoadModule` prevents filesystem modules entering clients.
//
// The plugin graph cannot use `instanceof`, so the domain-error predicate is
// exported from here rather than reimplemented as a duck-type check.
import { ContentPersistenceError } from "../../library";
import { createContentAiService, createNativeContentEditorial, EditorialError, type ContentAiProposal, type ContentAiProposer, type EditorialReceipt } from "../../editorial";
import type { ContentEntryRecord, ContentEntryRef } from "../../model";
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
      default: throw new EditorialError("invalid-request", "Unknown editorial operation.");
    }
  } catch (error) {
    if (!(error instanceof EditorialError)) throw error;
    return { ok: false, error: { code: error.code, message: error.message, diagnostics: error.diagnostics } };
  }
}

type ActivatedReader = Parameters<typeof runContentEditorial>[1];
const contentAiProposals = new Map<string, Map<string, ContentAiProposal & { receipt?: EditorialReceipt }>>();

/**
 * One Content-AI request from the Content editor. The proposer comes from the
 * host's configured Assistant provider; without one, Content-AI is unavailable.
 */
export async function runContentAi(
  store: FilesystemContentStore,
  readActivated: ActivatedReader,
  host: () => Promise<{ proposer: ContentAiProposer; canApply: boolean } | null>,
  operation: string,
  payload: unknown,
): Promise<{ ok: true; value: unknown } | { ok: false; error: { code: string; message: string; diagnostics: unknown[] } }> {
  try {
    const configured = await host();
    if (operation === "content-ai-status") return { ok: true, value: configured ? { available: true, provider: configured.proposer.label, canApply: configured.canApply } : { available: false } };
    if (!configured) throw new EditorialError("configuration-required", "Content-AI needs an Assistant provider in zudo-composer.config.ts.");
    let proposals = contentAiProposals.get(store.root);
    if (!proposals) contentAiProposals.set(store.root, proposals = new Map());
    const service = createContentAiService({
      boundary: (provenance) => createNativeContentEditorial({ store, provenance, readPublished: () => readPublishedFrom(store, readActivated) }),
      actor: CONTENT_EDITOR_PROVENANCE.actor,
      proposer: configured.proposer,
      createId: () => globalThis.crypto.randomUUID(),
      proposals,
      canApply: configured.canApply,
    });
    const input = (payload ?? {}) as never;
    switch (operation) {
      case "content-ai-scope": return { ok: true, value: await service.scope((input as { entry: ContentEntryRef }).entry) };
      case "content-ai-prepare": return { ok: true, value: await service.prepare(input) };
      case "content-ai-apply": return { ok: true, value: await service.apply(input) };
      case "content-ai-undo": return { ok: true, value: await service.undo(input) };
      default: throw new EditorialError("invalid-request", "Unknown Content-AI operation.");
    }
  } catch (error) {
    if (!(error instanceof EditorialError)) {
      if (error instanceof Error && error.name === "ProviderError") return { ok: false, error: { code: "unavailable", message: error.message, diagnostics: [] } };
      throw error;
    }
    return { ok: false, error: { code: error.code, message: error.message, diagnostics: error.diagnostics } };
  }
}
