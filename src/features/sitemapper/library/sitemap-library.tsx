"use client";

/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
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
      root: [{ id: `${id}-home`, title: "Home", children: [] }],
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
  const [outcome, setOutcome] = useState<SitemapInitializationOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);

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

  const create = async (): Promise<void> => {
    if (busy) return;
    const requested = globalThis.prompt?.("Sitemap name", "Untitled sitemap")?.trim();
    if (!requested) return;
    setBusy(true);
    setOperationError(null);
    try {
      const record = newRecord(idFactoryRef.current(requested), requested, nowRef.current());
      await requireFreshRecordId(provider, record.id);
      await provider.store.put(record);
      commitSummary(summarizeSitemap(record));
      await onOpen(cloneJson(record));
    } catch (reason) {
      setOperationError(message(reason, "The Sitemap could not be created."));
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
    if (busy || !globalThis.confirm?.("Delete this sitemap? This cannot be undone.")) return;
    setBusy(true);
    setOperationError(null);
    try {
      await provider.store.delete(id);
      if (outcome && outcome.status !== "error") {
        setOutcome({ ...outcome, summaries: outcome.summaries.filter((item) => item.id !== id) });
      }
    } catch (reason) {
      setOperationError(message(reason, "The Sitemap could not be deleted."));
    } finally {
      setBusy(false);
    }
  };

  if (!outcome) {
    return (
      <main aria-busy={busy}>
        <h1>Sitemaps</h1>
        {operationError ? (
          <div role="alert">
            <p>{operationError}</p>
            <button type="button" disabled={busy} onClick={() => void initialize("retry")}>Retry</button>
          </div>
        ) : <p>Loading Sitemaps…</p>}
      </main>
    );
  }
  if (outcome.status === "error") {
    return <main><h1>Sitemaps</h1><div role="alert"><p>{outcome.error.message}</p><button type="button" disabled={busy} onClick={() => void initialize("retry")}>Retry</button></div></main>;
  }
  if (outcome.status === "recovery-required") {
    return (
      <main><h1>Sitemaps</h1><div role="alert"><h2>Recovery required</h2><p>{outcome.recovery.message}</p><p>Starting fresh permanently deletes every stored Sitemap.</p><button type="button" disabled={busy} onClick={() => void initialize("retry")}>Retry</button> <button type="button" disabled={busy} onClick={() => void initialize("startFresh")}>Start fresh</button></div></main>
    );
  }

  return (
    <main>
      <header><h1>Sitemaps</h1><button type="button" disabled={busy} onClick={() => void create()}>New sitemap</button></header>
      {operationError && <p role="alert">{operationError}</p>}
      {summaries.length === 0 ? <p>No sitemaps yet.</p> : (
        <ul>{summaries.map((summary) => <li key={summary.id}><button type="button" disabled={busy} onClick={() => void open(summary.id)}><strong>{summary.name}</strong> · {summary.pageCount} {summary.pageCount === 1 ? "page" : "pages"}</button> <button type="button" disabled={busy} aria-label={`Duplicate ${summary.name}`} onClick={() => void duplicate(summary.id)}>Duplicate</button> <button type="button" disabled={busy} aria-label={`Delete ${summary.name}`} onClick={() => void remove(summary.id)}>Delete</button></li>)}</ul>
      )}
    </main>
  );
}

export default SitemapLibrary;
