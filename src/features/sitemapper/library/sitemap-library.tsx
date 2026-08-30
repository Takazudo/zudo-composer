"use client";

/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { DuplicateIcon, EditIcon, LibraryIcon, PlusIcon, RefreshIcon, TrashIcon } from "../../../components/icons";
import { cloneJson, createUuidIdFactory, type IdFactory } from "../../../shared";
import {
  compareSitemapSummariesNewestFirst,
  summarizeSitemap,
  type SitemapInitializationOutcome,
  type SitemapProvider,
  type SitemapRecord,
  type SitemapSummary,
} from "../../../sitemapper/library";
import { SITEMAP_SCHEMA_VERSION } from "../../../sitemapper/model";
import { SitemapLibraryDialog, type SitemapLibraryDialogState } from "./sitemap-library-dialog";

export interface SitemapLibraryProps {
  provider: SitemapProvider;
  onOpen: (record: SitemapRecord) => void | Promise<void>;
  idFactory?: IdFactory;
  now?: () => string;
}

function message(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function sort(summaries: readonly SitemapSummary[]): SitemapSummary[] {
  return [...summaries].sort(compareSitemapSummariesNewestFirst);
}

function newRecord(id: string, name: string, timestamp: string): SitemapRecord {
  return {
    id,
    createdAt: timestamp,
    updatedAt: timestamp,
    document: {
      schemaVersion: SITEMAP_SCHEMA_VERSION,
      id,
      name,
      root: [{ id: `${id}-home`, title: "Home", source: { kind: "unassigned" }, children: [] }],
    },
  };
}

async function requireFreshRecordId(provider: SitemapProvider, id: string): Promise<void> {
  const existing = await provider.store.get(id);
  if (existing.status !== "not-found") {
    throw new Error(`Sitemap “${id}” already exists; no data was overwritten.`);
  }
}

export function SitemapLibrary({ provider, onOpen, idFactory: suppliedIdFactory, now: suppliedNow }: SitemapLibraryProps): JSX.Element {
  const idFactoryRef = useRef(suppliedIdFactory ?? createUuidIdFactory());
  const nowRef = useRef(suppliedNow ?? (() => new Date().toISOString()));
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const [outcome, setOutcome] = useState<SitemapInitializationOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<SitemapLibraryDialogState | null>(null);

  const apply = useCallback((next: SitemapInitializationOutcome) => {
    setOutcome(next);
    setOperationError(null);
  }, []);

  const initialize = useCallback(async (mode: "initialize" | "retry" | "startFresh") => {
    setBusy(true);
    try {
      apply(await provider.initialization[mode]());
    } catch (reason) {
      setOperationError(message(reason, "The Sitemap library could not be initialized."));
    } finally {
      setBusy(false);
    }
  }, [apply, provider]);

  useEffect(() => { void initialize("initialize"); }, [initialize]);

  const summaries = outcome && outcome.status !== "error" ? outcome.summaries : [];
  const commitSummary = (summary: SitemapSummary): void => {
    if (!outcome || outcome.status === "error" || outcome.status === "recovery-required") return;
    setOutcome({ ...outcome, summaries: sort([summary, ...outcome.summaries.filter((item) => item.id !== summary.id)]) });
  };

  const create = async (requested: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setOperationError(null);
    try {
      const record = newRecord(idFactoryRef.current(requested), requested, nowRef.current());
      await requireFreshRecordId(provider, record.id);
      await provider.store.put(record);
      commitSummary(summarizeSitemap(record));
      setDialog(null);
      await onOpen(cloneJson(record));
    } catch (reason) {
      setOperationError(message(reason, "The Sitemap could not be created."));
    } finally {
      setBusy(false);
    }
  };

  const rename = async (id: string, requested: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setOperationError(null);
    try {
      const loaded = await provider.store.get(id);
      if (loaded.status !== "loaded") throw new Error(`Sitemap “${id}” could not be renamed (${loaded.status}).`);
      const record: SitemapRecord = {
        ...cloneJson(loaded.record),
        updatedAt: nowRef.current(),
        document: { ...cloneJson(loaded.record.document), name: requested },
      };
      await provider.store.put(record);
      commitSummary(summarizeSitemap(record));
      setDialog(null);
    } catch (reason) {
      setOperationError(message(reason, "The Sitemap could not be renamed."));
    } finally {
      setBusy(false);
    }
  };

  const open = async (id: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setOperationError(null);
    try {
      const loaded = await provider.store.get(id);
      if (loaded.status !== "loaded") throw new Error(`Sitemap “${id}” could not be opened (${loaded.status}).`);
      await onOpen(cloneJson(loaded.record));
    } catch (reason) {
      setOperationError(message(reason, "The Sitemap could not be opened."));
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async (id: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setOperationError(null);
    try {
      const loaded = await provider.store.get(id);
      if (loaded.status !== "loaded") throw new Error(`Sitemap “${id}” could not be duplicated (${loaded.status}).`);
      const duplicateId = idFactoryRef.current(loaded.record.document.name);
      const timestamp = nowRef.current();
      await requireFreshRecordId(provider, duplicateId);
      const record: SitemapRecord = {
        id: duplicateId,
        createdAt: timestamp,
        updatedAt: timestamp,
        document: { ...cloneJson(loaded.record.document), id: duplicateId, name: `${loaded.record.document.name} copy` },
      };
      await provider.store.put(record);
      commitSummary(summarizeSitemap(record));
    } catch (reason) {
      setOperationError(message(reason, "The Sitemap could not be duplicated."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setOperationError(null);
    try {
      await provider.store.delete(id);
      if (outcome && outcome.status !== "error") {
        setOutcome({ ...outcome, summaries: outcome.summaries.filter((item) => item.id !== id) });
      }
      setDialog(null);
    } catch (reason) {
      setOperationError(message(reason, "The Sitemap could not be deleted."));
    } finally {
      setBusy(false);
    }
  };

  if (!outcome) {
    return (
      <main class="sg-sitemapper-library" aria-busy={busy}>
        <header class="sg-sitemapper-library__header"><span class="sg-sitemapper-library__mark"><LibraryIcon size="lg" /></span><div><p class="sg-sitemapper-library__eyebrow">Sitemapper</p><h1>Sitemaps</h1></div></header>
        {operationError ? (
          <div class="sg-sitemapper-library-notice" role="alert">
            <p>{operationError}</p>
            <button type="button" class="sg-sitemapper-library-button" disabled={busy} onClick={() => void initialize("retry")}><RefreshIcon size="sm" />Retry</button>
          </div>
        ) : <p class="sg-sitemapper-library-notice" role="status">Loading Sitemaps…</p>}
      </main>
    );
  }
  if (outcome.status === "error") {
    return <main class="sg-sitemapper-library"><header class="sg-sitemapper-library__header"><div><p class="sg-sitemapper-library__eyebrow">Sitemapper</p><h1>Sitemaps</h1></div></header><div class="sg-sitemapper-library-notice" role="alert"><p>{outcome.error.message}</p><button type="button" class="sg-sitemapper-library-button" disabled={busy} onClick={() => void initialize("retry")}><RefreshIcon size="sm" />Retry</button></div></main>;
  }
  if (outcome.status === "recovery-required") {
    return (
      <main class="sg-sitemapper-library"><header class="sg-sitemapper-library__header"><div><p class="sg-sitemapper-library__eyebrow">Sitemapper</p><h1>Sitemaps</h1></div></header><div class="sg-sitemapper-library-notice sg-sitemapper-library-notice--danger" role="alert"><h2>Recovery required</h2><p>{outcome.recovery.message}</p><p>Starting fresh permanently deletes every stored Sitemap.</p><div class="sg-sitemapper-library-notice__actions"><button type="button" class="sg-sitemapper-library-button" disabled={busy} onClick={() => void initialize("retry")}><RefreshIcon size="sm" />Retry</button><button type="button" class="sg-sitemapper-library-button sg-sitemapper-library-button--danger" disabled={busy} onClick={() => void initialize("startFresh")}><TrashIcon size="sm" />Start fresh</button></div></div></main>
    );
  }

  return (
    <main class="sg-sitemapper-library">
      <header class="sg-sitemapper-library__header"><div class="sg-sitemapper-library__heading"><span class="sg-sitemapper-library__mark"><LibraryIcon size="lg" /></span><div><p class="sg-sitemapper-library__eyebrow">Sitemapper</p><h1>Sitemaps</h1><p>Open an existing sitemap or start a new site structure.</p></div></div><button ref={primaryActionRef} type="button" class="sg-sitemapper-library-button sg-sitemapper-library-button--primary" disabled={busy} onClick={() => { setOperationError(null); setDialog({ kind: "create" }); }}><PlusIcon size="sm" />New sitemap</button></header>
      {operationError && !dialog && <p class="sg-sitemapper-library-notice" role="alert">{operationError}</p>}
      {summaries.length === 0 ? <section class="sg-sitemapper-library-empty"><LibraryIcon size="lg" /><h2>No sitemaps yet</h2><p>Create a sitemap to organize pages, routes, and content assignments.</p><button type="button" class="sg-sitemapper-library-button sg-sitemapper-library-button--primary" disabled={busy} onClick={() => { setOperationError(null); setDialog({ kind: "create" }); }}><PlusIcon size="sm" />Create your first sitemap</button></section> : (
        <ul class="sg-sitemapper-library-list">{summaries.map((summary) => <li key={summary.id} class="sg-sitemapper-library-card"><button type="button" class="sg-sitemapper-library-card__open" disabled={busy} onClick={() => void open(summary.id)}><span class="sg-sitemapper-library-card__icon"><LibraryIcon size="md" /></span><span><strong>{summary.name}</strong><small>{summary.pageCount} {summary.pageCount === 1 ? "page" : "pages"}</small></span></button><div class="sg-sitemapper-library-card__actions"><button type="button" class="sg-sitemapper-library-button" disabled={busy} aria-label={`Rename ${summary.name}`} onClick={() => { setOperationError(null); setDialog({ kind: "rename", id: summary.id, name: summary.name }); }}><EditIcon size="sm" />Rename</button><button type="button" class="sg-sitemapper-library-button" disabled={busy} aria-label={`Duplicate ${summary.name}`} onClick={() => void duplicate(summary.id)}><DuplicateIcon size="sm" />Duplicate</button><button type="button" class="sg-sitemapper-library-button sg-sitemapper-library-button--danger" disabled={busy} aria-label={`Delete ${summary.name}`} onClick={() => { setOperationError(null); setDialog({ kind: "delete", id: summary.id, name: summary.name }); }}><TrashIcon size="sm" />Delete</button></div></li>)}</ul>
      )}
      <SitemapLibraryDialog
        state={dialog}
        busy={busy}
        error={dialog ? operationError : null}
        fallbackFocusRef={primaryActionRef}
        onClose={() => { setDialog(null); setOperationError(null); }}
        onSubmitName={(name) => dialog?.kind === "rename" ? rename(dialog.id, name) : create(name)}
        onConfirmDelete={() => dialog?.kind === "delete" ? remove(dialog.id) : undefined}
      />
    </main>
  );
}

export default SitemapLibrary;
