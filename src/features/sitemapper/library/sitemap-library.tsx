"use client";

import { computed, getScope, Show, signal, type Child } from "@takazudo/zfb/zudo-react";
import type { AppServices } from "../../../app/services";
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
  createLibraryConfirm,
  createLibraryQuery,
  createLibrarySelection,
  type LibraryFacet,
  type LibraryRowContract,
  type LibrarySort,
} from "../../../components/library-page";
import { ConfirmDialog } from "../../../components/overlay";
import { Banner, Button, type DataTableColumn } from "../../../components/ui";
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
import { sitemapperHref } from "../app/sitemapper-intent";
import { SitemapNameDialog } from "./name-dialog";
import { withSitemapperWorkspaceLock } from "../app/sitemapper-workspace-lock";

type NameDialogState = { kind: "create" } | { kind: "rename"; id: string; name: string };

export interface SitemapLibraryProps {
  provider: SitemapProvider;
  /** Opens a Sitemap; the route drives this as a real `/sitemapper?sitemap=` navigation. */
  navigate: (href: string) => void;
  /** A malformed deep link, reported above the table rather than silently ignored. */
  notice?: Child;
  /** The shell's route services; absent when mounted standalone. */
  services?: AppServices;
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
      schemaVersion: SITEMAP_SCHEMA_VERSION, navigation: { primary: [], footer: [] },
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

/** One stable empty list, so the query and selection see a stable input. */
const NO_SUMMARIES: readonly SitemapSummary[] = [];

const CONTRACT: LibraryRowContract<SitemapSummary> = {
  id: (row) => row.id,
  name: (row) => row.name,
  icon: () => SitemapperIcon,
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
  services,
  idFactory: suppliedIdFactory,
  now: suppliedNow,
}: SitemapLibraryProps): Child {
  const scope = getScope();
  const idFactory = suppliedIdFactory ?? createUuidIdFactory();
  const now = suppliedNow ?? (() => new Date().toISOString());
  const outcome = signal<SitemapInitializationOutcome | null>(null);
  const busy = signal(false);
  const operationError = signal<string | null>(null);
  const dialog = signal<NameDialogState | null>(null);
  const workspaceIntegration = services?.workspace.integration;

  const assertNoActiveDeletion = async (ids?: readonly string[]): Promise<void> => {
    if (!workspaceIntegration) return;
    const metadata = await workspaceIntegration.workspace.metadata();
    const active = metadata.metadata.activeSitemap;
    if (active.providerId !== provider.descriptor?.id) return;
    if (ids !== undefined && !ids.includes(active.recordId)) return;
    throw new Error("The active Sitemap cannot be deleted. Select another Sitemap as active first.");
  };

  const initialize = async (mode: "initialize" | "retry" | "startFresh"): Promise<void> => {
    busy.value = true;
    try {
      let next: SitemapInitializationOutcome;
      if (mode === "startFresh") {
        const result = await withSitemapperWorkspaceLock(workspaceIntegration?.workspace.id, async () => {
          await assertNoActiveDeletion();
          return provider.initialization[mode]();
        });
        next = await result;
      } else next = await provider.initialization[mode]();
      if (scope.abortSignal.aborted) return;
      outcome.value = next;
      operationError.value = null;
    } catch (reason) {
      if (scope.abortSignal.aborted) return;
      operationError.value = message(reason, "The Sitemap library could not be initialized.");
    } finally {
      if (!scope.abortSignal.aborted) busy.value = false;
    }
  };

  scope.onActivate(() => { void initialize("initialize"); });

  const summaries = computed(() => {
    const current = outcome.value;
    return current && current.status !== "error" ? current.summaries : NO_SUMMARIES;
  });
  const query = createLibraryQuery({
    rows: summaries,
    searchText: (row) => `${row.name} ${row.id}`,
    facets: FACETS,
    sorts: SORTS,
  });
  const selection = createLibrarySelection({ rows: summaries, visibleRows: query.rows, rowId: CONTRACT.id });
  const confirm = createLibraryConfirm();

  const commitSummary = (summary: SitemapSummary): void => {
    const current = outcome.value;
    if (current && current.status !== "error") {
      outcome.value = { ...current, summaries: sort([summary, ...current.summaries.filter((item) => item.id !== summary.id)]) };
    }
  };

  const dropSummaries = (ids: ReadonlySet<string>): void => {
    const current = outcome.value;
    if (current && current.status !== "error") {
      outcome.value = { ...current, summaries: current.summaries.filter((item) => !ids.has(item.id)) };
    }
  };

  const create = async (requested: string): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    operationError.value = null;
    try {
      const record = newRecord(idFactory(requested), requested, now());
      await requireFreshRecordId(provider, record.id);
      await provider.store.put(record);
      if (scope.abortSignal.aborted) return;
      commitSummary(summarizeSitemap(record));
      dialog.value = null;
      navigate(sitemapperHref(provider.descriptor!.id, record.id));
    } catch (reason) {
      if (!scope.abortSignal.aborted) operationError.value = message(reason, "The Sitemap could not be created.");
    } finally {
      if (!scope.abortSignal.aborted) busy.value = false;
    }
  };

  const rename = async (id: string, requested: string): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    operationError.value = null;
    try {
      const loaded = await provider.store.get(id);
      if (loaded.status !== "loaded") throw new Error(`Sitemap “${id}” could not be renamed (${loaded.status}).`);
      const record: SitemapRecord = {
        ...cloneJson(loaded.record),
        updatedAt: now(),
        document: { ...cloneJson(loaded.record.document), name: requested },
      };
      await provider.store.put(record);
      if (scope.abortSignal.aborted) return;
      commitSummary(summarizeSitemap(record));
      dialog.value = null;
    } catch (reason) {
      if (!scope.abortSignal.aborted) operationError.value = message(reason, "The Sitemap could not be renamed.");
    } finally {
      if (!scope.abortSignal.aborted) busy.value = false;
    }
  };

  const duplicate = async (id: string): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    operationError.value = null;
    try {
      const loaded = await provider.store.get(id);
      if (loaded.status !== "loaded") throw new Error(`Sitemap “${id}” could not be duplicated (${loaded.status}).`);
      const duplicateId = idFactory(loaded.record.document.name);
      const timestamp = now();
      await requireFreshRecordId(provider, duplicateId);
      const record: SitemapRecord = {
        id: duplicateId,
        createdAt: timestamp,
        updatedAt: timestamp,
        document: { ...cloneJson(loaded.record.document), id: duplicateId, name: `${loaded.record.document.name} copy` },
      };
      await provider.store.put(record);
      if (scope.abortSignal.aborted) return;
      commitSummary(summarizeSitemap(record));
    } catch (reason) {
      if (!scope.abortSignal.aborted) operationError.value = message(reason, "The Sitemap could not be duplicated.");
    } finally {
      if (!scope.abortSignal.aborted) busy.value = false;
    }
  };

  const remove = async (ids: readonly string[]): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    operationError.value = null;
    // Deletions are reported one by one: a bulk delete that fails halfway must
    // still drop the records that are actually gone, or the list lies.
    const deleted = new Set<string>();
    try {
      await withSitemapperWorkspaceLock(workspaceIntegration?.workspace.id, async () => {
        await assertNoActiveDeletion(ids);
        for (const id of ids) {
          await provider.store.delete(id);
          deleted.add(id);
        }
      });
    } catch (reason) {
      if (!scope.abortSignal.aborted) operationError.value = message(reason, "The Sitemap could not be deleted.");
    } finally {
      if (!scope.abortSignal.aborted) {
        if (deleted.size > 0) {
          dropSummaries(deleted);
          selection.clear();
        }
        busy.value = false;
      }
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

  const clearLibrary = async (): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    operationError.value = null;
    try {
      await withSitemapperWorkspaceLock(workspaceIntegration?.workspace.id, async () => {
        await assertNoActiveDeletion(summaries.value.map((summary) => summary.id));
        await provider.store.clear();
      });
      if (scope.abortSignal.aborted) return;
      outcome.value = { status: "ready", summaries: [] };
      selection.clear();
    } catch (reason) {
      if (!scope.abortSignal.aborted) operationError.value = message(reason, "The Sitemaps could not be cleared.");
    } finally {
      if (!scope.abortSignal.aborted) busy.value = false;
    }
  };

  const askClear = (): void => {
    confirm.request({
      title: "Clear library?",
      message: `Delete all ${summaries.value.length} sitemaps? This cannot be undone.`,
      confirmLabel: "Clear library",
      tone: "danger",
      onConfirm: () => void clearLibrary(),
    });
  };

  const startCreate = (): void => {
    operationError.value = null;
    dialog.value = { kind: "create" };
  };

  if (!provider.descriptor) return <Banner tone="err">The Sitemap provider identity is unavailable.</Banner>;
  const providerId = provider.descriptor.id;
  const storageLabel = provider.descriptor.label;
  const ready = computed(() => outcome.value !== null && outcome.value.status !== "error");
  const status = computed(() => outcome.value?.status ?? null);
  const hasSelection = computed(() => selection.selectedCount.value > 0);
  const bulkBar = (
    <BulkBar
      count={selection.selectedCount}
      describeCount={(count) => `${count} ${count === 1 ? "sitemap" : "sitemaps"} selected`}
      actions={[{
        id: "delete",
        label: "Delete",
        icon: TrashIcon,
        tone: "danger",
        onSelect: () => askDelete(selection.selectedRows.value.map((row) => row.name), selection.selectedRows.value.map((row) => row.id)),
      }]}
      onClear={selection.clear}
    />
  );

  // The header action and the empty state's call to action are the same
  // command, but they are not the same control: two buttons reading
  // "New sitemap" on one screen is an ambiguity for pointer and screen-reader
  // users alike.
  return (
    <LibraryPage
      class="sg-sitemapper-library"
      icon={SitemapperIcon}
      title="Sitemaps"
      purpose="Organize Compositions and Mapping route families into a navigable site structure."
      primaryAction={
        <Button variant="primary" disabled={busy} on:click={startCreate}>
          <PlusIcon size="sm" />
          New sitemap
        </Button>
      }
    >
      {notice}
      <Show when={computed(() => Boolean(operationError.value) && dialog.value === null)}>{() => <Banner tone="err">{computed(() => operationError.value ?? "")}</Banner>}</Show>
      <Show when={computed(() => status.value === "error")}>{() => (
        <LibraryUnavailableBanner
          title="Sitemap library unavailable."
          description={computed(() => { const current = outcome.value; return current?.status === "error" ? current.error.message : ""; })}
          onRetry={() => void initialize("retry")}
        />
      )}</Show>
      <Show when={computed(() => status.value === "recovery-required")}>{() => (
        <LibraryRecoveryBanner
          title="Stored sitemaps need recovery."
          description={computed(() => { const current = outcome.value; return current?.status === "recovery-required" ? current.recovery.message : ""; })}
          onRetry={() => void initialize("retry")}
          onStartFresh={() => confirm.request({
            title: "Start fresh?",
            message: "Every stored Sitemap is permanently deleted, including the ones that still read correctly.",
            confirmLabel: "Start fresh",
            tone: "danger",
            onConfirm: () => void initialize("startFresh"),
          })}
        />
      )}</Show>
      <Show when={computed(() => outcome.value === null)}>{() => <LibrarySkeleton columns={5} label="Loading sitemaps…" />}</Show>
      <Show when={computed(() => ready.value && summaries.value.length === 0)}>{() => (
        <LibraryEmpty
          icon={SitemapperIcon}
          title="No sitemaps yet"
          description="A sitemap holds the page tree, the routes it derives, and what renders each page."
          action={
            <Button variant="primary" disabled={busy} on:click={startCreate}>
              <PlusIcon size="sm" />
              Create your first sitemap
            </Button>
          }
        />
      )}</Show>
      <Show when={computed(() => ready.value && summaries.value.length > 0)}>{() => (
        <>
          <LibraryToolbar
            query={query}
            searchLabel="Filter sitemaps"
            searchPlaceholder="Filter by name or ID"
            end={
              <Button size="sm" variant="ghost" disabled={busy} on:click={askClear}>
                <TrashIcon size="sm" />
                Clear library
              </Button>
            }
          />
          <LibraryTable
            caption="Sitemaps"
            rows={query.rows}
            contract={{ ...CONTRACT, href: (row) => sitemapperHref(providerId, row.id) }}
            columns={COLUMNS}
            selection={selection}
            kindHeader="Assignment"
            empty={<LibraryNoMatch search={query.search} onClearFilters={query.clearFilters} />}
            bulkBar={computed(() => (hasSelection.value ? bulkBar : null))}
            rowMenu={(row) => ({
              label: row.name,
              open: { id: "open", label: "Open", kbd: "↵", href: sitemapperHref(providerId, row.id) },
              actions: [
                { id: "rename", label: "Rename…", icon: EditIcon, onSelect: () => { operationError.value = null; dialog.value = { kind: "rename", id: row.id, name: row.name }; } },
                { id: "duplicate", label: "Duplicate", icon: DuplicateIcon, onSelect: () => void duplicate(row.id) },
              ],
              destructive: [
                { id: "delete", label: "Delete…", icon: TrashIcon, onSelect: () => askDelete([row.name], [row.id]) },
              ],
            })}
          />
          <LibraryPagination summary={computed(() => `${query.rows.value.length} of ${summaries.value.length} sitemaps · ${storageLabel}`)} />
        </>
      )}</Show>
      <SitemapNameDialog
        open={computed(() => dialog.value !== null)}
        title={computed(() => (dialog.value?.kind === "rename" ? "Rename sitemap" : "Create sitemap"))}
        description={computed(() => { const current = dialog.value; return current?.kind === "rename" ? `Choose a new name for ${current.name}.` : "Name the sitemap you want to start."; })}
        label="Sitemap name"
        submitLabel={computed(() => (dialog.value?.kind === "rename" ? "Save name" : "Create sitemap"))}
        initialValue={computed(() => { const current = dialog.value; return current?.kind === "rename" ? current.name : "Untitled sitemap"; })}
        busy={busy}
        error={computed(() => (dialog.value === null ? null : operationError.value))}
        onSubmit={(value) => { const current = dialog.value; void (current?.kind === "rename" ? rename(current.id, value) : create(value)); }}
        onClose={() => { dialog.value = null; operationError.value = null; }}
      />
      <ConfirmDialog {...confirm.dialogProps} />
    </LibraryPage>
  );
}

export default SitemapLibrary;
