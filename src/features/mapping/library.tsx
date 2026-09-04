/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { DuplicateIcon, MappingIcon, PlusIcon, TrashIcon } from "../../components/icons";
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
  type LibraryKindTag,
  type LibraryRowContract,
  type LibrarySort,
} from "../../components/library-page";
import { ConfirmDialog } from "../../components/overlay";
import { Banner, Button, type DataTableColumn } from "../../components/ui";
import type { MappingSummary } from "../../mapping";
import type { MappingEditorController, MappingEditorState, MappingLibraryDetail } from "./controller";
import { mappingDeepLinkHref } from "./deep-link";
import { NewMappingDialog } from "./new-mapping-dialog";

// The Mapping library on the shared library pattern. It replaces a grid of
// truncating cards: a Mapping is identified by the pair it joins, and a card
// that clips "Missing Content source" to one line is exactly the information
// an author came here for.

export interface MappingLibraryProps {
  state: MappingEditorState;
  controller: MappingEditorController;
  /** Route transitions: opening, creating and duplicating are real navigations. */
  navigate: (href: string) => void;
  /** A deep link that could not be opened, reported above the table. */
  notice?: JSX.Element | null;
  error: string | null;
  run: (action: () => void | Promise<void>) => void;
}

/** Readiness of one library row, from its resolved definition. */
function readiness(detail: MappingLibraryDetail | undefined): LibraryKindTag {
  if (!detail) return { label: "Checking…", tone: "neutral" };
  const blocking = detail.definition.diagnostics.length;
  return blocking === 0 ? { label: "Ready", tone: "ok" } : { label: `${blocking} blocking`, tone: "err" };
}

const FACETS: readonly LibraryFacet<MappingSummary>[] = [
  {
    id: "bindings",
    label: "Bindings",
    options: [
      { id: "all", label: "All" },
      { id: "bound", label: "Has bindings", match: (row) => row.bindingCount > 0 },
      { id: "empty", label: "No bindings", match: (row) => row.bindingCount === 0 },
    ],
  },
];

const SORTS: readonly LibrarySort<MappingSummary>[] = [
  { id: "updated", label: "Updated", compare: (a, b) => b.updatedAt.localeCompare(a.updatedAt) },
  { id: "name", label: "Name", compare: (a, b) => a.name.localeCompare(b.name) },
  { id: "bindings", label: "Bindings", compare: (a, b) => b.bindingCount - a.bindingCount },
];

export function MappingLibrary({ state, controller, navigate, notice, error, run }: MappingLibraryProps): JSX.Element {
  const [creating, setCreating] = useState(false);
  const confirm = useLibraryConfirm();
  const summaries = state.mappings;
  const details = state.libraryDetails;
  const providerId = controller.provider.descriptor.id;

  const query = useLibraryQuery({
    rows: summaries,
    searchText: (row) => `${row.name} ${row.id}`,
    facets: FACETS,
    sorts: SORTS,
  });
  const selection = useLibrarySelection({ rows: summaries, visibleRows: query.rows, rowId: (row) => row.id });

  const contract: LibraryRowContract<MappingSummary> = {
    id: (row) => row.id,
    name: (row) => row.name,
    icon: () => MappingIcon,
    href: (row) => mappingDeepLinkHref({ providerId, mappingId: row.id }),
    kind: (row) => readiness(details[row.id]),
    updatedAt: (row) => row.updatedAt,
  };

  const columns: readonly DataTableColumn<MappingSummary>[] = [
    {
      key: "source",
      header: "Source model",
      variant: "muted",
      cell: (row) => details[row.id]?.definition.contentModel?.document.name ?? "Missing Content model",
    },
    {
      key: "target",
      header: "Target composition",
      variant: "muted",
      cell: (row) => details[row.id]?.definition.composition?.document.name ?? "Missing Composition",
    },
    { key: "bindings", header: "Bindings", variant: "num", cell: (row) => row.bindingCount },
  ];

  const remove = (ids: readonly string[]) => run(async () => {
    // Deleted one by one so a bulk delete that fails halfway still drops the
    // records that are actually gone.
    for (const id of ids) await controller.delete(id);
    selection.clear();
  });

  const askDelete = (names: readonly string[], ids: readonly string[]) => confirm.request({
    title: ids.length === 1 ? `Delete ${names[0]}?` : `Delete ${ids.length} Mappings?`,
    message: ids.length === 1
      ? "Its bindings go with it. The Content model and the Composition are untouched. This cannot be undone."
      : "Their bindings go with them. The Content models and Compositions are untouched. This cannot be undone.",
    confirmLabel: "Delete",
    tone: "danger",
    onConfirm: () => remove(ids),
  });

  const canCreate = state.contentModels.length > 0 && state.compositions.length > 0;
  const ready = state.phase === "ready" || state.phase === "recovery";

  return (
    <LibraryPage
      class="cms-mapping-library"
      icon={MappingIcon}
      title="Mappings"
      purpose="Drive a Composition's props from a Content model's fields, one Entry at a time."
      primaryAction={
        <Button variant="primary" disabled={!canCreate} onClick={() => setCreating(true)}>
          <PlusIcon size="sm" />
          New mapping
        </Button>
      }
    >
      {notice}
      {error && !creating ? <Banner tone="err">{error}</Banner> : null}
      {state.catalogFailures.length > 0 ? (
        <Banner tone="warn" title="Some providers are unavailable.">
          {state.catalogFailures.map((failure) => (
            <p key={failure}>{failure}</p>
          ))}
        </Banner>
      ) : null}
      {state.phase === "error" ? (
        <LibraryUnavailableBanner
          title="Mapping library unavailable."
          description={state.message}
          onRetry={() => run(() => controller.retryInitialization())}
        />
      ) : null}
      {state.phase === "recovery" ? (
        <LibraryRecoveryBanner
          title="Stored mappings need recovery."
          description={state.recoveryMessage ?? state.message}
          onRetry={() => run(() => controller.retryInitialization())}
          onStartFresh={() => confirm.request({
            title: "Start fresh?",
            message: "Every quarantined mapping record is permanently discarded, including the ones that still read correctly.",
            confirmLabel: "Start fresh",
            tone: "danger",
            onConfirm: () => run(() => controller.startFresh()),
          })}
        />
      ) : null}
      {state.phase === "idle" || state.phase === "loading" ? (
        <LibrarySkeleton columns={6} label="Loading mappings…" />
      ) : null}
      {ready && summaries.length === 0 ? (
        <LibraryEmpty
          icon={MappingIcon}
          title="No mappings yet"
          description="A mapping joins one Content model to one Composition and says which field drives which prop."
          action={
            <Button variant="primary" disabled={!canCreate} onClick={() => setCreating(true)}>
              <PlusIcon size="sm" />
              {canCreate ? "Create your first mapping" : "A Content model and a Composition are needed first"}
            </Button>
          }
        />
      ) : null}
      {ready && summaries.length > 0 ? (
        <>
          <LibraryToolbar query={query} searchLabel="Filter mappings" searchPlaceholder="Filter by name or ID" />
          <LibraryTable
            caption="Mappings"
            rows={query.rows}
            contract={contract}
            columns={columns}
            selection={selection}
            kindHeader="Status"
            empty={<LibraryNoMatch search={query.search} onClearFilters={query.clearFilters} />}
            bulkBar={selection.selectedCount > 0 ? (
              <BulkBar
                count={selection.selectedCount}
                describeCount={(count) => `${count} ${count === 1 ? "mapping" : "mappings"} selected`}
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
              open: { id: "open", label: "Open", kbd: "↵", href: mappingDeepLinkHref({ providerId, mappingId: row.id }) },
              actions: [{
                id: "duplicate",
                label: "Duplicate",
                icon: DuplicateIcon,
                onSelect: () => run(async () => {
                  const id = await controller.duplicate(row.id);
                  navigate(mappingDeepLinkHref({ providerId, mappingId: id }));
                }),
              }],
              destructive: [{ id: "delete", label: "Delete…", icon: TrashIcon, onSelect: () => askDelete([row.name], [row.id]) }],
            })}
          />
          <LibraryPagination
            summary={`${query.rows.length} of ${summaries.length} mappings · ${controller.provider.descriptor.label}`}
          />
        </>
      ) : null}
      <NewMappingDialog
        open={creating}
        contentModels={state.contentModels}
        compositions={state.compositions}
        error={creating ? error : null}
        onSubmit={(name, contentModel, composition) => run(async () => {
          const id = await controller.create(name, contentModel, composition);
          setCreating(false);
          navigate(mappingDeepLinkHref({ providerId, mappingId: id }));
        })}
        onClose={() => setCreating(false)}
      />
      <ConfirmDialog {...confirm.dialogProps} />
    </LibraryPage>
  );
}
