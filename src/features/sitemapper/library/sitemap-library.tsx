"use client";

/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { ComponentChildren, JSX } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { DuplicateIcon, EditIcon, PlusIcon, SitemapperIcon, TrashIcon } from "../../../components/icons";
import {
  BulkBar,
  LibraryEmpty,
  LibraryNoMatch,
  LibraryPage,
  LibraryPagination,
  LibraryRecoveryBanner,
  LibrarySkeleton,
  LibraryTable,
  LibraryToolbar,
  LibraryUnavailableBanner,
  useLibraryConfirm,
  useLibraryQuery,
  useLibrarySelection,
  type LibraryFacet,
  type LibraryRowContract,
  type LibrarySort,
} from "../../../components/library-page";
import { ConfirmDialog } from "../../../components/overlay";
import { Banner, Button, type DataTableColumn } from "../../../components/ui";
import { cloneJson, createUuidIdFactory, type IdFactory } from "../../../shared";
import {
  compareSitemapSummariesNewestFirst,
  SITEMAP_PROVIDERS,
  summarizeSitemap,
  type SitemapInitializationOutcome,
  type SitemapProvider,
  type SitemapRecord,
  type SitemapSummary,
} from "../../../sitemapper/library";
import { SITEMAP_SCHEMA_VERSION } from "../../../sitemapper/model";
import { sitemapperHref } from "../app/sitemapper-intent";
import { SitemapNameDialog } from "./name-dialog";

type NameDialogState = { kind: "create" } | { kind: "rename"; id: string; name: string };

export interface SitemapLibraryProps {
  provider: SitemapProvider;
  /** Opens a Sitemap; the route drives this as a real `/sitemapper?sitemap=` navigation. */
  navigate: (href: string) => void;
  /** A malformed deep link, reported above the table rather than silently ignored. */
  notice?: ComponentChildren;
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

/** One stable empty list, so the query and selection hooks see a stable input. */
const NO_SUMMARIES: readonly SitemapSummary[] = [];

const CONTRACT: LibraryRowContract<SitemapSummary> = {
  id: (row) => row.id,
  name: (row) => row.name,
  icon: () => SitemapperIcon,
  href: (row) => sitemapperHref(row.id),
  kind: (row) => (row.unassignedCount === 0
    ? { label: "All assigned", tone: "ok" }
    : { label: `${row.unassignedCount} unassigned`, tone: "warn" }),
  updatedAt: (row) => row.updatedAt,
};

const COLUMNS: readonly DataTableColumn<SitemapSummary>[] = [
  {
    key: "pages",
    header: "Pages",
    variant: "num",
    cell: (row) => row.pageCount,
  },
];

const FACETS: readonly LibraryFacet<SitemapSummary>[] = [
  {
    id: "assignment",
    label: "Assignment",
    options: [
      { id: "all", label: "All" },
      { id: "complete", label: "Fully assigned", match: (row) => row.unassignedCount === 0 },
      { id: "incomplete", label: "Has unassigned pages", match: (row) => row.unassignedCount > 0 },
    ],
  },
];

const SORTS: readonly LibrarySort<SitemapSummary>[] = [
  { id: "updated", label: "Updated", compare: compareSitemapSummariesNewestFirst },
  { id: "name", label: "Name", compare: (a, b) => a.name.localeCompare(b.name) },
  { id: "pages", label: "Pages", compare: (a, b) => b.pageCount - a.pageCount },
];

export function SitemapLibrary({
  provider,
  navigate,
  notice,
  idFactory: suppliedIdFactory,
  now: suppliedNow,
}: SitemapLibraryProps): JSX.Element {
  const idFactoryRef = useRef(suppliedIdFactory ?? createUuidIdFactory());
  const nowRef = useRef(suppliedNow ?? (() => new Date().toISOString()));
  const [outcome, setOutcome] = useState<SitemapInitializationOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<NameDialogState | null>(null);

  const initialize = useCallback(async (mode: "initialize" | "retry" | "startFresh") => {
    setBusy(true);
    try {
      setOutcome(await provider.initialization[mode]());
      setOperationError(null);
    } catch (reason) {
      setOperationError(message(reason, "The Sitemap library could not be initialized."));
    } finally {
      setBusy(false);
    }
  }, [provider]);

  useEffect(() => { void initialize("initialize"); }, [initialize]);

  const summaries = outcome && outcome.status !== "error" ? outcome.summaries : NO_SUMMARIES;
  const query = useLibraryQuery({
    rows: summaries,
    searchText: (row) => `${row.name} ${row.id}`,
    facets: FACETS,
    sorts: SORTS,
  });
  const selection = useLibrarySelection({ rows: summaries, visibleRows: query.rows, rowId: CONTRACT.id });
  const confirm = useLibraryConfirm();

  const commitSummary = (summary: SitemapSummary): void => {
    setOutcome((current) => (current && current.status !== "error"
      ? { ...current, summaries: sort([summary, ...current.summaries.filter((item) => item.id !== summary.id)]) }
      : current));
  };

  const dropSummaries = (ids: ReadonlySet<string>): void => {
    setOutcome((current) => (current && current.status !== "error"
      ? { ...current, summaries: current.summaries.filter((item) => !ids.has(item.id)) }
      : current));
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
      navigate(sitemapperHref(record.id));
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

  const remove = async (ids: readonly string[]): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setOperationError(null);
    // Deletions are reported one by one: a bulk delete that fails halfway must
    // still drop the records that are actually gone, or the list lies.
    const deleted = new Set<string>();
    try {
      for (const id of ids) {
        await provider.store.delete(id);
        deleted.add(id);
      }
    } catch (reason) {
      setOperationError(message(reason, "The Sitemap could not be deleted."));
    } finally {
      if (deleted.size > 0) {
        dropSummaries(deleted);
        selection.clear();
      }
      setBusy(false);
    }
  };

  const askDelete = (names: readonly string[], ids: readonly string[]): void => {
    confirm.request({
      title: ids.length === 1 ? `Delete ${names[0]}?` : `Delete ${ids.length} sitemaps?`,
      message: ids.length === 1
        ? "Its pages and their source assignments go with it. This cannot be undone."
        : "Their pages and source assignments go with them. This cannot be undone.",
      confirmLabel: "Delete",
      tone: "danger",
      onConfirm: () => void remove(ids),
    });
  };

  const startCreate = (): void => {
    setOperationError(null);
    setDialog({ kind: "create" });
  };

  // The header action and the empty state's call to action are the same
  // command, but they are not the same control: two buttons reading
  // "New sitemap" on one screen is an ambiguity for pointer and screen-reader
  // users alike.
  const newSitemap = (
    <Button variant="primary" disabled={busy} onClick={startCreate}>
      <PlusIcon size="sm" />
      New sitemap
    </Button>
  );

  const storageLabel = (provider.descriptor ?? SITEMAP_PROVIDERS.indexeddb).label;
  const ready = outcome !== null && outcome.status !== "error";

  return (
    <LibraryPage
      class="sg-sitemapper-library"
      icon={SitemapperIcon}
      title="Sitemaps"
      purpose="Organize Compositions and Mapping route families into a navigable site structure."
      primaryAction={newSitemap}
    >
      {notice}
      {operationError && dialog === null ? <Banner tone="err">{operationError}</Banner> : null}
      {outcome?.status === "error" ? (
        <LibraryUnavailableBanner
          title="Sitemap library unavailable."
          description={outcome.error.message}
          onRetry={() => void initialize("retry")}
        />
      ) : null}
      {outcome?.status === "recovery-required" ? (
        <LibraryRecoveryBanner
          title="Stored sitemaps need recovery."
          description={outcome.recovery.message}
          onRetry={() => void initialize("retry")}
          onStartFresh={() => confirm.request({
            title: "Start fresh?",
            message: "Every stored Sitemap is permanently deleted, including the ones that still read correctly.",
            confirmLabel: "Start fresh",
            tone: "danger",
            onConfirm: () => void initialize("startFresh"),
          })}
        />
      ) : null}
      {outcome === null ? <LibrarySkeleton columns={5} label="Loading sitemaps…" /> : null}
      {ready && summaries.length === 0 ? (
        <LibraryEmpty
          icon={SitemapperIcon}
          title="No sitemaps yet"
          description="A sitemap holds the page tree, the routes it derives, and what renders each page."
          action={
            <Button variant="primary" disabled={busy} onClick={startCreate}>
              <PlusIcon size="sm" />
              Create your first sitemap
            </Button>
          }
        />
      ) : null}
      {ready && summaries.length > 0 ? (
        <>
          <LibraryToolbar query={query} searchLabel="Filter sitemaps" searchPlaceholder="Filter by name or ID" />
          <LibraryTable
            caption="Sitemaps"
            rows={query.rows}
            contract={CONTRACT}
            columns={COLUMNS}
            selection={selection}
            kindHeader="Assignment"
            empty={<LibraryNoMatch search={query.search} onClearFilters={query.clearFilters} />}
            bulkBar={selection.selectedCount > 0 ? (
              <BulkBar
                count={selection.selectedCount}
                describeCount={(count) => `${count} ${count === 1 ? "sitemap" : "sitemaps"} selected`}
                actions={[{
                  id: "delete",
                  label: "Delete",
                  icon: TrashIcon,
                  tone: "danger",
                  onSelect: () => askDelete(selection.selectedRows.map((row) => row.name), selection.selectedRows.map((row) => row.id)),
                }]}
                onClear={selection.clear}
              />
            ) : undefined}
            rowMenu={(row) => ({
              label: row.name,
              open: { id: "open", label: "Open", kbd: "↵", href: sitemapperHref(row.id) },
              actions: [
                { id: "rename", label: "Rename…", icon: EditIcon, onSelect: () => { setOperationError(null); setDialog({ kind: "rename", id: row.id, name: row.name }); } },
                { id: "duplicate", label: "Duplicate", icon: DuplicateIcon, onSelect: () => void duplicate(row.id) },
              ],
              destructive: [
                { id: "delete", label: "Delete…", icon: TrashIcon, onSelect: () => askDelete([row.name], [row.id]) },
              ],
            })}
          />
          <LibraryPagination summary={`${query.rows.length} of ${summaries.length} sitemaps · ${storageLabel}`} />
        </>
      ) : null}
      <SitemapNameDialog
        open={dialog !== null}
        title={dialog?.kind === "rename" ? "Rename sitemap" : "Create sitemap"}
        description={dialog?.kind === "rename"
          ? `Choose a new name for ${dialog.name}.`
          : "Name the sitemap you want to start."}
        label="Sitemap name"
        submitLabel={dialog?.kind === "rename" ? "Save name" : "Create sitemap"}
        initialValue={dialog?.kind === "rename" ? dialog.name : "Untitled sitemap"}
        busy={busy}
        error={dialog === null ? null : operationError}
        onSubmit={(value) => { void (dialog?.kind === "rename" ? rename(dialog.id, value) : create(value)); }}
        onClose={() => { setDialog(null); setOperationError(null); }}
      />
      <ConfirmDialog {...confirm.dialogProps} />
    </LibraryPage>
  );
}

export default SitemapLibrary;
