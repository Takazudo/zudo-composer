import { computed, Show, signal, type Child, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import type { AppServices } from "../../app/services";
import { Rebuild } from "../../components/rebuild";
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
  createLibraryConfirm,
  createLibraryQuery,
  createLibrarySelection,
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
import { memo } from "../../components/reactive";

// The Mapping library on the shared library pattern. It replaces a grid of
// truncating cards: a Mapping is identified by the pair it joins, and a card
// that clips "Missing Content source" to one line is exactly the information
// an author came here for.

export interface MappingLibraryProps {
  state: ReadonlySignal<MappingEditorState>;
  controller: MappingEditorController;
  /** Route transitions: opening, creating and duplicating are real navigations. */
  navigate: (href: string) => void;
  /** A deep link that could not be opened, reported above the table. */
  notice?: Child;
  error: ReadonlySignal<string | null>;
  services?: AppServices;
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

export function MappingLibrary({ state, controller, navigate, notice, error, run }: MappingLibraryProps): Child {
  const creating = signal(false);
  const clearing = signal(false);
  const confirm = createLibraryConfirm();
  const summaries = computed(() => state.value.mappings);
  const details = computed(() => state.value.libraryDetails);
  const phase = computed(() => state.value.phase);
  const providerId = controller.provider.descriptor.id;

  const query = createLibraryQuery({
    rows: summaries,
    searchText: (row) => `${row.name} ${row.id}`,
    facets: FACETS,
    sorts: SORTS,
  });
  const selection = createLibrarySelection({ rows: summaries, visibleRows: query.rows, rowId: (row) => row.id });

  // Cells read the readiness details, which arrive after the summaries; the
  // table is rebuilt when either changes, and only then.
  const tableInputs = memo(() => [query.rows.value, details.value] as const);
  let builtFrom: typeof tableInputs.value | null = null;
  let builtRows: readonly MappingSummary[] = [];
  const tableRows = computed(() => {
    const inputs = tableInputs.value;
    if (inputs !== builtFrom) { builtFrom = inputs; builtRows = inputs[0].slice(); }
    return builtRows;
  });
  const detailOf = (row: MappingSummary) => tableInputs.value[1][row.id];

  const contract: LibraryRowContract<MappingSummary> = {
    id: (row) => row.id,
    name: (row) => row.name,
    icon: () => MappingIcon,
    href: (row) => mappingDeepLinkHref({ providerId, mappingId: row.id }),
    kind: (row) => readiness(detailOf(row)),
    updatedAt: (row) => row.updatedAt,
  };

  const columns: readonly DataTableColumn<MappingSummary>[] = [
    {
      key: "source",
      header: "Source model",
      variant: "muted",
      cell: (row) => { const detail = detailOf(row); return detail ? detail.definition.contentModel?.document.name ?? "Missing Content model" : "Checking…"; },
    },
    {
      key: "target",
      header: "Target composition",
      variant: "muted",
      cell: (row) => { const detail = detailOf(row); return detail ? detail.definition.composition?.document.name ?? "Missing Composition" : "Checking…"; },
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

  const clearLibrary = () => {
    if (clearing.value) return;
    clearing.value = true;
    run(async () => {
      try {
        await controller.clear();
      } finally {
        clearing.value = false;
      }
    });
  };

  const askClear = () => confirm.request({
    title: "Clear library?",
    message: `Delete all ${summaries.value.length} mappings? This cannot be undone.`,
    confirmLabel: "Clear library",
    tone: "danger",
    onConfirm: clearLibrary,
  });

  const canCreate = computed(() => state.value.contentModels.length > 0 && state.value.compositions.length > 0);
  const ready = computed(() => phase.value === "ready" || phase.value === "recovery");
  const hasSelection = computed(() => selection.selectedCount.value > 0);
  const bulkBar = (
    <BulkBar
      count={selection.selectedCount}
      describeCount={(count) => `${count} ${count === 1 ? "mapping" : "mappings"} selected`}
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

  return (
    <LibraryPage
      class="cms-mapping-library"
      icon={MappingIcon}
      title="Mappings"
      purpose="Drive a Composition's props from a Content model's fields, one Entry at a time."
      primaryAction={
        <Button variant="primary" disabled={computed(() => !canCreate.value)} on:click={() => { creating.value = true; }}>
          <PlusIcon size="sm" />
          New mapping
        </Button>
      }
    >
      {notice}
      <Show when={computed(() => Boolean(error.value) && !creating.value)}>{() => <Banner tone="err">{computed(() => error.value ?? "")}</Banner>}</Show>
      <Rebuild value={computed(() => state.value.catalogFailures)}>{(failures) => failures.length > 0 ? (
        <Banner tone="warn" title="Some providers are unavailable.">
          {failures.map((failure) => (
            <p key={failure}>{failure}</p>
          ))}
        </Banner>
      ) : null}</Rebuild>
      <Show when={computed(() => phase.value === "error")}>{() => (
        <LibraryUnavailableBanner
          title="Mapping library unavailable."
          description={computed(() => state.value.message)}
          onRetry={() => run(() => controller.retryInitialization())}
        />
      )}</Show>
      <Show when={computed(() => phase.value === "recovery")}>{() => (
        <LibraryRecoveryBanner
          title="Stored mappings need recovery."
          description={computed(() => state.value.recoveryMessage ?? state.value.message)}
          onRetry={() => run(() => controller.retryInitialization())}
          onStartFresh={() => confirm.request({
            title: "Start fresh?",
            message: "Every quarantined mapping record is permanently discarded, including the ones that still read correctly.",
            confirmLabel: "Start fresh",
            tone: "danger",
            onConfirm: () => run(() => controller.startFresh()),
          })}
        />
      )}</Show>
      <Show when={computed(() => phase.value === "idle" || phase.value === "loading")}>{() => (
        <LibrarySkeleton columns={6} label="Loading mappings…" />
      )}</Show>
      <Show when={computed(() => ready.value && summaries.value.length === 0)}>{() => (
        <LibraryEmpty
          icon={MappingIcon}
          title="No mappings yet"
          description="A mapping joins one Content model to one Composition and says which field drives which prop."
          action={
            <Button variant="primary" disabled={computed(() => !canCreate.value)} on:click={() => { creating.value = true; }}>
              <PlusIcon size="sm" />
              {computed(() => (canCreate.value ? "Create your first mapping" : "A Content model and a Composition are needed first"))}
            </Button>
          }
        />
      )}</Show>
      <Show when={computed(() => ready.value && summaries.value.length > 0)}>{() => (
        <>
          <LibraryToolbar
            query={query}
            searchLabel="Filter mappings"
            searchPlaceholder="Filter by name or ID"
            end={
              <Button size="sm" variant="ghost" disabled={clearing} on:click={askClear}>
                <TrashIcon size="sm" />
                Clear library
              </Button>
            }
          />
          <LibraryTable
            caption="Mappings"
            rows={tableRows}
            contract={contract}
            columns={columns}
            selection={selection}
            kindHeader="Status"
            empty={<LibraryNoMatch search={query.search} onClearFilters={query.clearFilters} />}
            bulkBar={computed(() => (hasSelection.value ? bulkBar : null))}
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
            summary={computed(() => `${query.rows.value.length} of ${summaries.value.length} mappings · ${controller.provider.descriptor.label}`)}
          />
        </>
      )}</Show>
      <NewMappingDialog
        open={creating}
        contentModels={computed(() => state.value.contentModels)}
        compositions={computed(() => state.value.compositions)}
        error={computed(() => (creating.value ? error.value : null))}
        onSubmit={(name, contentModel, composition) => run(async () => {
          const id = await controller.create(name, contentModel, composition);
          creating.value = false;
          navigate(mappingDeepLinkHref({ providerId, mappingId: id }));
        })}
        onClose={() => { creating.value = false; }}
      />
      <ConfirmDialog {...confirm.dialogProps} />
    </LibraryPage>
  );
}
