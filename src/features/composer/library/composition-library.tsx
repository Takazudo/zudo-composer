"use client";

import { computed, For, getScope, Show, signal, type Child, type Ref } from "@takazudo/zfb/zudo-react";
import type { VersionedAssetStore } from "../../../assets/library";
import type {
  BrowserJsxExportOutcome,
  CompositionInitializationOutcome,
  CompositionProviderId,
  CompositionSummary,
} from "../../../composer/browser";
import {
  ChevronDownIcon,
  ComposerIcon,
  DownloadIcon,
  DuplicateIcon,
  EditIcon,
  PlusIcon,
  TrashIcon,
} from "../../../components/icons";
import {
  BulkBar,
  createLibraryConfirm,
  createLibraryQuery,
  createLibrarySelection,
  LibraryEmpty,
  LibraryNoMatch,
  LibraryPage,
  LibraryPagination,
  LibraryRecoveryBanner,
  LibrarySkeleton,
  LibraryTable,
  LibraryToolbar,
  LibraryUnavailableBanner,
  LibraryViewToggle,
  RowMenu,
  type LibraryFacet,
  type LibraryKindTag,
  type LibraryRowContract,
  type LibrarySort,
  type LibraryView,
  type RowMenuProps,
} from "../../../components/library-page";
import { ConfirmDialog, createMenu, Dialog, Menu, MenuRadioItem } from "../../../components/overlay";
import { read, type MaybeSignal } from "../../../components/reactive";
import { Rebuild } from "../../../components/rebuild";
import { Banner, Button, Chip, Field, Input, SegmentedControl } from "../../../components/ui";
import { Keyed } from "../../../runtime";
import type { ComposerComponentProvider } from "../active-pack";
import { memoOn } from "../reactive/memo";
import { formatComposerRoute } from "../routing";
import { ComposerExportDialog } from "../ui/export/export-dialog";
import { NewCompositionDialog } from "./new-composition-dialog";
import type {
  CompositionLibraryCreateIntent,
  CompositionLibraryIntents,
  CompositionLibraryProviderCapability,
} from "./library-contract";
import { COMPOSITION_PREVIEW_FALLBACK_LIMIT, CompositionLibraryPreview, type CompositionThumbnailDevice } from "./composition-library-preview";

export interface CompositionLibraryProps {
  componentProvider: ComposerComponentProvider;
  providers: readonly CompositionLibraryProviderCapability[];
  initialProviderId: CompositionProviderId;
  intents: CompositionLibraryIntents;
  /** Production composition callback after a provider result is committed. */
  onInitializationApplied?: (
    providerId: CompositionProviderId,
    outcome: CompositionInitializationOutcome,
  ) => void;
  /** Opens the New-composition dialog once, for the `/composer?new=1` route intent. */
  openNewOnMount?: boolean;
  /** Fired once `openNewOnMount` has been acted on, so the caller can drop it for later remounts. */
  onOpenNewConsumed?: () => void;
  /** The workspace's versioned Asset store, for resolving managed Asset references in previews. */
  assetStore?: VersionedAssetStore;
}

type RenameDialogState = { id: string; name: string } | null;

type ExportDialogState =
  | { name: string; outcome: BrowserJsxExportOutcome }
  | null;

function message(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

/** One stable empty list, so the query and selection see a stable input. */
const NO_SUMMARIES: readonly CompositionSummary[] = [];

function kindTag(row: CompositionSummary): LibraryKindTag {
  if (row.publicationKind === "global-template") return { label: "Global template", tone: "accent" };
  if (row.publicationKind === "pattern") return { label: "Pattern", tone: "accent" };
  return { label: "Plain", tone: "plain" };
}

const FACETS: readonly LibraryFacet<CompositionSummary>[] = [
  {
    id: "kind",
    label: "Kind",
    options: [
      { id: "all", label: "All" },
      { id: "plain", label: "Plain", match: (row) => row.publicationKind === undefined },
      { id: "pattern", label: "Pattern", match: (row) => row.publicationKind === "pattern" },
      { id: "global-template", label: "Global template", match: (row) => row.publicationKind === "global-template" },
    ],
  },
];

function compareUpdatedNewestFirst(a: CompositionSummary, b: CompositionSummary): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const SORTS: readonly LibrarySort<CompositionSummary>[] = [
  { id: "updated", label: "Updated", compare: compareUpdatedNewestFirst },
  { id: "name", label: "Name", compare: (a, b) => a.name.localeCompare(b.name) },
  { id: "created", label: "Created", compare: (a, b) => (a.createdAt === b.createdAt ? 0 : a.createdAt > b.createdAt ? -1 : 1) },
  { id: "nodes", label: "Nodes", compare: (a, b) => b.nodeCount - a.nodeCount },
];

function sortByUpdated(summaries: readonly CompositionSummary[]): CompositionSummary[] {
  return [...summaries].sort(compareUpdatedNewestFirst);
}

// The provider switch that replaces the old storage card: a menu button
// naming the active provider, with one radio item per available provider.
function ProviderMenu({
  providers,
  activeProviderId,
  disabled,
  onChange,
}: {
  providers: readonly CompositionLibraryProviderCapability[];
  activeProviderId: MaybeSignal<CompositionProviderId>;
  disabled?: MaybeSignal<boolean>;
  onChange: (providerId: CompositionProviderId) => void;
}): Child {
  const triggerRef: Ref<HTMLButtonElement> = { current: null };
  const menu = createMenu(triggerRef, { align: "end" });
  if (providers.length === 0) return null;
  const activeLabel = computed(() => {
    const id = read(activeProviderId);
    return (providers.find(({ descriptor }) => descriptor.id === id) ?? providers[0]!).descriptor.label;
  });

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        class="cms-btn cms-btn--sm"
        disabled={computed(() => Boolean(read(disabled)))}
        {...menu.triggerProps}
      >
        <span>{computed(() => `Provider: ${activeLabel.value}`)}</span>
        <ChevronDownIcon size="xs" class="cms-library-toolbar__caret" />
      </button>
      <Menu controller={menu} label="Provider">
        {providers.map(({ descriptor }) => (
          <MenuRadioItem
            checked={computed(() => descriptor.id === read(activeProviderId))}
            onSelect={() => {
              if (descriptor.id !== read(activeProviderId)) onChange(descriptor.id);
            }}
          >
            {descriptor.label}
          </MenuRadioItem>
        ))}
      </Menu>
    </>
  );
}

interface RenameDialogProps {
  state: MaybeSignal<RenameDialogState>;
  busy: MaybeSignal<boolean>;
  error: MaybeSignal<string | null>;
  onSubmit: (id: string, name: string) => void;
  onClose: () => void;
}

// The one naming question outside creation — renaming a stored composition —
// on the shared `Dialog`. Each opening is a fresh session, so its field state
// is reset before the dialog can be seen or typed into.
function CompositionRenameDialog(props: RenameDialogProps): Child {
  const state = computed(() => read(props.state));
  return (
    <Keyed value={state} by={(current) => (current ? `open:${current.id}` : "closed")}>
      {(current) => <CompositionRenameSession {...props} state={current.value} />}
    </Keyed>
  );
}

function CompositionRenameSession({ state, busy: busyProp, error, onSubmit, onClose }: Omit<RenameDialogProps, "state"> & { state: RenameDialogState }): Child {
  const fieldRef: Ref<HTMLInputElement> = { current: null };
  const value = signal(state?.name ?? "");
  const missing = signal(false);
  const busy = computed(() => Boolean(read(busyProp)));

  function submit(): void {
    if (busy.value || !state) return;
    const next = value.value.trim();
    if (next === "") {
      missing.value = true;
      return;
    }
    missing.value = false;
    onSubmit(state.id, next);
  }

  return (
    <Dialog
      open={state !== null}
      title="Rename composition"
      initialFocusRef={fieldRef}
      dismissOnBackdrop={computed(() => !busy.value)}
      onClose={() => {
        if (!busy.value) onClose();
      }}
      footer={
        <>
          <button type="button" class="cms-dialog__action" disabled={busy} on:click={onClose}>
            Cancel
          </button>
          <button type="button" class="cms-dialog__action cms-dialog__action--primary" disabled={busy} on:click={submit}>
            {computed(() => (busy.value ? "Saving…" : "Save name"))}
          </button>
        </>
      }
    >
      <p class="cms-dialog__message">{state ? `Choose a new name for ${state.name}.` : null}</p>
      <Show when={computed(() => Boolean(read(error)))}>
        {() => <Banner tone="err">{computed(() => read(error) ?? "")}</Banner>}
      </Show>
      <Field label="Name" error={computed(() => (missing.value ? "Enter a composition name." : undefined))}>
        {(field) => (
          <Input
            field={field}
            elementRef={fieldRef}
            modelValue={value}
            disabled={busy}
            on:input={() => { missing.value = false; }}
            on:keydown={(event: KeyboardEvent) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              submit();
            }}
          />
        )}
      </Field>
    </Dialog>
  );
}

export function CompositionLibrary({
  componentProvider,
  providers,
  initialProviderId,
  intents,
  onInitializationApplied,
  openNewOnMount = false,
  onOpenNewConsumed,
  assetStore,
}: CompositionLibraryProps): Child {
  const scope = getScope();
  const availableProviders = providers.filter((provider) => provider.available);
  const activeProviderId = signal<CompositionProviderId>(
    availableProviders.find(({ descriptor }) => descriptor.id === initialProviderId)?.descriptor.id
      ?? availableProviders[0]?.descriptor.id
      ?? initialProviderId,
  );
  const outcome = signal<CompositionInitializationOutcome | null>(null);
  const busy = signal(availableProviders.length > 0);
  const operationError = signal<string | null>(
    availableProviders.length === 0 ? "No composition storage provider is available." : null,
  );
  const newDialogOpen = signal(false);
  const renameDialog = signal<RenameDialogState>(null);
  const exportDialog = signal<ExportDialogState>(null);
  const view = signal<LibraryView>("table");
  const thumbnailDevice = signal<CompositionThumbnailDevice>("desktop");
  const openPreviewKey = signal<string | null>(null);
  let createdForNavigation: CompositionSummary | null = null;

  // Always commits the result — including a returned "error" status — so a
  // retry against the SAME provider replaces a stale description with the
  // fresh one. Only a thrown exception goes to `operationError` instead.
  async function load(providerId: CompositionProviderId, mode: "initialize" | "retry" | "startFresh"): Promise<boolean> {
    busy.value = true;
    operationError.value = null;
    try {
      const result = await intents[mode](providerId);
      if (scope.abortSignal.aborted) return false;
      activeProviderId.value = providerId;
      openPreviewKey.value = null;
      outcome.value = result;
      if (result.status !== "error") onInitializationApplied?.(providerId, result);
      return result.status !== "error";
    } catch (reason) {
      if (scope.abortSignal.aborted) return false;
      operationError.value = message(reason, "The composition library could not be loaded.");
      return false;
    } finally {
      if (!scope.abortSignal.aborted) busy.value = false;
    }
  }

  // Switching providers is different: a failure must leave the previously
  // active provider and its already-displayed rows exactly as they were,
  // rather than replacing them with the new provider's error.
  async function switchProvider(providerId: CompositionProviderId): Promise<void> {
    if (providerId === activeProviderId.value || busy.value) return;
    busy.value = true;
    operationError.value = null;
    try {
      const result = await intents.initialize(providerId);
      if (scope.abortSignal.aborted) return;
      if (result.status === "error") {
        operationError.value = result.error.message;
        return;
      }
      activeProviderId.value = providerId;
      outcome.value = result;
      onInitializationApplied?.(providerId, result);
    } catch (reason) {
      if (scope.abortSignal.aborted) return;
      operationError.value = message(reason, "The composition library could not be loaded.");
    } finally {
      if (!scope.abortSignal.aborted) busy.value = false;
    }
  }

  scope.onActivate(() => {
    if (availableProviders.length > 0) void load(activeProviderId.value, "initialize");
    // `openNewOnMount` is a one-shot route intent, not a toggle.
    if (openNewOnMount) {
      operationError.value = null;
      newDialogOpen.value = true;
      onOpenNewConsumed?.();
    }
  });

  const summaries = computed(() => {
    const current = outcome.value;
    return current?.status === "ready" ? current.summaries : NO_SUMMARIES;
  });
  const ready = computed(() => outcome.value?.status === "ready");
  const query = createLibraryQuery({
    rows: summaries,
    searchText: (row) => `${row.name} ${row.id}`,
    facets: FACETS,
    sorts: SORTS,
  });
  const selection = createLibrarySelection({ rows: summaries, visibleRows: query.rows, rowId: (row) => row.id });
  const confirm = createLibraryConfirm();
  const previewDialogNeedsBudget = computed(() => {
    const key = openPreviewKey.value;
    const providerId = activeProviderId.value;
    return key !== null
      && !query.rows.value.slice(0, COMPOSITION_PREVIEW_FALLBACK_LIMIT).some((row) => `${providerId}:${row.id}` === key);
  });

  scope.effect(() => {
    const key = openPreviewKey.value;
    if (key === null) return;
    const prefix = `${activeProviderId.value}:`;
    if (!key.startsWith(prefix) || !summaries.value.some((row) => `${prefix}${row.id}` === key)) {
      openPreviewKey.value = null;
    }
  });

  const updateReady = (change: (summaries: readonly CompositionSummary[]) => readonly CompositionSummary[]): void => {
    const current = outcome.value;
    if (current?.status === "ready") outcome.value = { ...current, summaries: [...change(current.summaries)] };
  };
  const commitSummary = (summary: CompositionSummary): void => {
    updateReady((current) => sortByUpdated([summary, ...current.filter((item) => item.id !== summary.id)]));
  };
  const addSummaries = (created: readonly CompositionSummary[]): void => {
    if (created.length === 0) return;
    updateReady((current) => sortByUpdated([...current, ...created]));
  };
  const dropSummaries = (ids: ReadonlySet<string>): void => {
    updateReady((current) => current.filter((item) => !ids.has(item.id)));
  };

  // Opens a just-created (or just-duplicated) record and reports whether that
  // succeeded, without ever pretending the record itself was not saved.
  async function openCreatedComposition(
    created: CompositionSummary,
  ): Promise<{ status: "created" } | { status: "navigation-error"; message: string }> {
    try {
      const opened = await intents.open({ providerId: activeProviderId.value, recordId: created.id });
      if (opened.status === "not-found") {
        return { status: "navigation-error", message: "The new composition was saved but could not be opened because it was not found." };
      }
      createdForNavigation = null;
      if (!scope.abortSignal.aborted) newDialogOpen.value = false;
      return { status: "created" };
    } catch (reason) {
      return {
        status: "navigation-error",
        message: `The new composition was saved, but opening failed. ${message(reason, "")}`.trim(),
      };
    }
  }

  async function rename(id: string, name: string): Promise<void> {
    if (busy.value) return;
    busy.value = true;
    operationError.value = null;
    try {
      const updated = await intents.rename({ providerId: activeProviderId.value, recordId: id }, name);
      if (scope.abortSignal.aborted) return;
      commitSummary(updated);
      renameDialog.value = null;
    } catch (reason) {
      if (scope.abortSignal.aborted) return;
      operationError.value = message(reason, "The composition could not be renamed.");
    } finally {
      if (!scope.abortSignal.aborted) busy.value = false;
    }
  }

  async function duplicateRow(id: string): Promise<void> {
    if (busy.value) return;
    busy.value = true;
    operationError.value = null;
    try {
      const created = await intents.duplicate({ providerId: activeProviderId.value, recordId: id });
      if (scope.abortSignal.aborted) return;
      commitSummary(created);
      try {
        const opened = await intents.open({ providerId: activeProviderId.value, recordId: created.id });
        if (scope.abortSignal.aborted) return;
        if (opened.status === "not-found") {
          operationError.value = "The duplicate was saved but could not be opened because it was not found.";
        }
      } catch (reason) {
        if (scope.abortSignal.aborted) return;
        operationError.value = `The duplicate was saved, but opening failed. ${message(reason, "")}`.trim();
      }
    } catch (reason) {
      if (scope.abortSignal.aborted) return;
      operationError.value = message(reason, "The composition could not be duplicated.");
    } finally {
      if (!scope.abortSignal.aborted) busy.value = false;
    }
  }

  async function duplicateBulk(ids: readonly string[]): Promise<void> {
    if (busy.value) return;
    busy.value = true;
    operationError.value = null;
    const created: CompositionSummary[] = [];
    try {
      for (const id of ids) {
        created.push(await intents.duplicate({ providerId: activeProviderId.value, recordId: id }));
        if (scope.abortSignal.aborted) return;
      }
    } catch (reason) {
      if (scope.abortSignal.aborted) return;
      operationError.value = message(reason, "The compositions could not be duplicated.");
    } finally {
      if (!scope.abortSignal.aborted) {
        addSummaries(created);
        if (created.length > 0) selection.clear();
        busy.value = false;
      }
    }
  }

  async function remove(ids: readonly string[]): Promise<void> {
    busy.value = true;
    operationError.value = null;
    // Deletions are reported one by one: a bulk delete that fails halfway must
    // still drop the records that are actually gone, or the list lies.
    const deleted = new Set<string>();
    try {
      for (const id of ids) {
        const ok = await intents.delete({ providerId: activeProviderId.value, recordId: id });
        if (scope.abortSignal.aborted) return;
        if (ok) deleted.add(id);
      }
      if (deleted.size < ids.length) {
        operationError.value = "Some compositions were not found, so they could not be deleted. The library list has been preserved.";
      }
    } catch (reason) {
      if (scope.abortSignal.aborted) return;
      operationError.value = message(reason, "The composition could not be deleted.");
    } finally {
      if (!scope.abortSignal.aborted) {
        if (deleted.size > 0) {
          dropSummaries(deleted);
          selection.clear();
        }
        busy.value = false;
      }
    }
  }

  async function clearLibrary(): Promise<void> {
    if (busy.value) return;
    busy.value = true;
    operationError.value = null;
    try {
      await intents.clear(activeProviderId.value);
      if (scope.abortSignal.aborted) return;
      outcome.value = { status: "ready", summaries: [] };
      selection.clear();
    } catch (reason) {
      if (scope.abortSignal.aborted) return;
      operationError.value = message(reason, "The compositions could not be cleared.");
    } finally {
      if (!scope.abortSignal.aborted) busy.value = false;
    }
  }

  async function exportRow(row: CompositionSummary): Promise<void> {
    operationError.value = null;
    try {
      const exported = await intents.exportJsx({ providerId: activeProviderId.value, recordId: row.id });
      if (scope.abortSignal.aborted) return;
      exportDialog.value = { name: exported.documentName, outcome: exported.outcome };
    } catch (reason) {
      if (scope.abortSignal.aborted) return;
      operationError.value = message(reason, "The composition could not be exported.");
    }
  }

  function askDelete(names: readonly string[], ids: readonly string[]): void {
    confirm.request({
      title: ids.length === 1 ? `Delete ${names[0]}?` : `Delete ${ids.length} compositions?`,
      message: ids.length === 1
        ? "This cannot be undone."
        : "Their content cannot be recovered afterward.",
      confirmLabel: "Delete",
      tone: "danger",
      onConfirm: () => void remove(ids),
    });
  }

  function askClear(): void {
    confirm.request({
      title: "Clear library?",
      message: `Delete all ${summaries.value.length} compositions? This cannot be undone.`,
      confirmLabel: "Clear library",
      tone: "danger",
      onConfirm: () => void clearLibrary(),
    });
  }

  function startCreate(): void {
    operationError.value = null;
    newDialogOpen.value = true;
  }

  const startRename = (row: CompositionSummary): void => {
    operationError.value = null;
    renameDialog.value = { id: row.id, name: row.name };
  };

  const hrefFor = (row: CompositionSummary): string =>
    formatComposerRoute({ kind: "detail", providerId: activeProviderId.value, recordId: row.id });

  const contract: LibraryRowContract<CompositionSummary> = {
    id: (row) => row.id,
    name: (row) => row.name,
    icon: () => ComposerIcon,
    href: hrefFor,
    kind: kindTag,
    updatedAt: (row) => row.updatedAt,
  };

  const rowActions = (row: CompositionSummary): Pick<RowMenuProps, "actions" | "destructive"> => ({
    actions: [
      { id: "rename", label: "Rename…", icon: EditIcon, onSelect: () => startRename(row) },
      { id: "duplicate", label: "Duplicate", icon: DuplicateIcon, onSelect: () => void duplicateRow(row.id) },
      { id: "export", label: "Export JSX", icon: DownloadIcon, onSelect: () => void exportRow(row) },
    ],
    destructive: [
      { id: "delete", label: "Delete…", icon: TrashIcon, onSelect: () => askDelete([row.name], [row.id]) },
    ],
  });

  const activeLabel = computed(() => {
    const id = activeProviderId.value;
    return (providers.find(({ descriptor }) => descriptor.id === id) ?? availableProviders[0])?.descriptor.label ?? "Unavailable";
  });

  const hasSelection = computed(() => selection.selectedCount.value > 0);
  const bulkBar = memoOn(
    () => [hasSelection.value] as const,
    (selected): Child => (selected ? (
      <BulkBar
        count={selection.selectedCount}
        describeCount={(count) => `${count} ${count === 1 ? "composition" : "compositions"} selected`}
        actions={[
          {
            id: "duplicate",
            label: "Duplicate",
            icon: DuplicateIcon,
            onSelect: () => void duplicateBulk(selection.selectedRows.value.map((row) => row.id)),
          },
          {
            id: "delete",
            label: "Delete",
            icon: TrashIcon,
            tone: "danger",
            onSelect: () => askDelete(
              selection.selectedRows.value.map((row) => row.name),
              selection.selectedRows.value.map((row) => row.id),
            ),
          },
        ]}
        onClear={selection.clear}
      />
    ) : null),
  );

  // Only the failure states draw a banner; their identity follows the outcome,
  // so a retry that fails again shows the fresh description.
  const failure = computed(() => {
    const current = outcome.value;
    return current?.status === "error" || current?.status === "recovery-required" ? current : null;
  });

  const noMatch = (): Child => <LibraryNoMatch search={query.search} onClearFilters={query.clearFilters} />;

  return (
    <LibraryPage
      class="cms-composition-library"
      icon={ComposerIcon}
      title="Compositions"
      purpose="Reusable page structures built from the provider components."
      actions={(
        <ProviderMenu
          providers={availableProviders}
          activeProviderId={activeProviderId}
          disabled={computed(() => busy.value || availableProviders.length === 0)}
          onChange={(providerId) => void switchProvider(providerId)}
        />
      )}
      // The header action and the empty state's call to action are the same
      // command, but not the same control: two "New composition" buttons on one
      // screen is an ambiguity for pointer and screen-reader users alike.
      primaryAction={(
        <Button variant="primary" disabled={busy} on:click={startCreate}>
          <PlusIcon size="sm" />
          New composition
        </Button>
      )}
    >
      <Show when={computed(() => operationError.value !== null && operationError.value !== "")}>
        {() => <Banner tone="err">{computed(() => operationError.value ?? "")}</Banner>}
      </Show>
      <Rebuild value={failure}>
        {(current) => {
          if (current?.status === "error") {
            return (
              <LibraryUnavailableBanner
                title="Composition library unavailable."
                description={current.error.message}
                onRetry={() => void load(activeProviderId.value, "retry")}
              />
            );
          }
          if (current?.status === "recovery-required") {
            return (
              <LibraryRecoveryBanner
                title="Stored compositions need recovery."
                description={`${current.recovery.message} The original source has been preserved.`}
                onRetry={() => void load(activeProviderId.value, "retry")}
                onStartFresh={() => confirm.request({
                  title: "Start fresh?",
                  message: "Every stored composition is permanently deleted, including the ones that still read correctly.",
                  confirmLabel: "Start fresh",
                  tone: "danger",
                  onConfirm: () => void load(activeProviderId.value, "startFresh"),
                })}
              />
            );
          }
          return null;
        }}
      </Rebuild>
      <Show when={computed(() => outcome.value === null && availableProviders.length > 0)}>
        {() => <LibrarySkeleton columns={4} label="Loading compositions…" />}
      </Show>
      <Show when={computed(() => ready.value && summaries.value.length === 0)}>
        {() => (
          <LibraryEmpty
            icon={ComposerIcon}
            title="No compositions yet"
            description="A composition is a reusable page structure built from the provider components."
            action={
              <Button variant="primary" disabled={busy} on:click={startCreate}>
                <PlusIcon size="sm" />
                Create your first composition
              </Button>
            }
          />
        )}
      </Show>
      <Show when={computed(() => ready.value && summaries.value.length > 0)}>
        {() => (
          <>
            <LibraryToolbar
              query={query}
              searchLabel="Filter compositions"
              searchPlaceholder="Filter by name or ID"
              end={<>
                <SegmentedControl<CompositionThumbnailDevice>
                  label="Thumbnail device"
                  size="sm"
                  value={thumbnailDevice}
                  onChange={(device) => { thumbnailDevice.value = device; }}
                  options={[{ value: "desktop", label: "Desktop previews" }, { value: "phone", label: "Phone previews" }]}
                />
                <LibraryViewToggle value={view} onChange={(next) => { view.value = next; }} tableLabel="List" />
                <Button size="sm" variant="ghost" disabled={busy} on:click={askClear}>
                  <TrashIcon size="sm" />
                  Clear library
                </Button>
              </>}
            />
            {/* Row links name the active provider, so a provider switch rebuilds the rows too. */}
            <Keyed value={computed(() => `${view.value}\u0000${activeProviderId.value}`)} by={(key) => key}>
              {() => (view.value === "table" ? (
                <LibraryTable
                  caption="Compositions"
                  rows={query.rows}
                  contract={contract}
                  columns={[{ key: "nodes", header: "Nodes", variant: "num", cell: (row) => row.nodeCount }]}
                  selection={selection}
                  empty={noMatch()}
                  bulkBar={bulkBar}
                  rowMenu={(row) => ({
                    label: row.name,
                    open: { id: "open", label: "Open", kbd: "↵", href: hrefFor(row) },
                    ...rowActions(row),
                  })}
                />
              ) : (
                <div class="cms-composition-library__cards" aria-label="Composition cards">
                  <Show when={computed(() => query.rows.value.length === 0)} fallback={() => (
                    <For each={query.rows} by={(row) => `${activeProviderId.value}:${row.id}:${row.updatedAt}`}>
                      {(item, index) => {
                        const row = item.value;
                        const href = hrefFor(row);
                        const tag = kindTag(row);
                        const previewKey = `${activeProviderId.value}:${row.id}`;
                        return (
                          <article class="cms-composition-card">
                            <CompositionLibraryPreview
                              row={row}
                              providerId={activeProviderId.value}
                              componentProvider={componentProvider}
                              intents={intents}
                              device={thumbnailDevice}
                              fallbackNear={computed(() => index.value < COMPOSITION_PREVIEW_FALLBACK_LIMIT - (previewDialogNeedsBudget.value ? 1 : 0))}
                              dialogOpen={computed(() => openPreviewKey.value === previewKey)}
                              onDialogOpenChange={(open) => { openPreviewKey.value = open ? previewKey : null; }}
                              assetStore={assetStore}
                            />
                            <div class="cms-composition-card__body">
                              <div class="cms-composition-card__meta">
                                <Chip tone={tag.tone}>{tag.label}</Chip>
                                <span>{`${row.nodeCount} node${row.nodeCount === 1 ? "" : "s"}`}</span>
                              </div>
                              <h2><a href={href}>{row.name}</a></h2>
                              <p>{row.publicationKind === "global-template" ? `Shared layout · ${row.outletLabel || row.outletId || "content outlet"}` : row.publicationKind === "pattern" ? "Reusable structure copied on insertion." : "Local page structure."}</p>
                            </div>
                            <div class="cms-composition-card__actions">
                              <a class="cms-btn cms-btn--sm" href={href}>Edit</a>
                              <RowMenu label={row.name} open={{ id: "open", label: "Open", kbd: "↵", href }} {...rowActions(row)} />
                            </div>
                          </article>
                        );
                      }}
                    </For>
                  )}>
                    {noMatch}
                  </Show>
                </div>
              ))}
            </Keyed>
            <LibraryPagination summary={computed(() => `${query.rows.value.length} of ${summaries.value.length} compositions · ${activeLabel.value}`)} />
          </>
        )}
      </Show>
      <NewCompositionDialog
        open={newDialogOpen}
        providerId={activeProviderId}
        intents={intents}
        manifest={componentProvider.catalog}
        entries={componentProvider.manifest.components}
        onSubmit={async (intent: CompositionLibraryCreateIntent) => {
          let created: CompositionSummary;
          try {
            created = await intents.create(intent);
          } catch (reason) {
            return { status: "create-error" as const, message: message(reason, "The composition could not be created.") };
          }
          if (!scope.abortSignal.aborted) commitSummary(created);
          createdForNavigation = created;
          return openCreatedComposition(created);
        }}
        onRetryNavigation={async () => {
          const created = createdForNavigation;
          return created
            ? openCreatedComposition(created)
            : { status: "navigation-error" as const, message: "There is no saved composition to retry opening." };
        }}
        onClose={() => { createdForNavigation = null; newDialogOpen.value = false; }}
      />
      <CompositionRenameDialog
        state={renameDialog}
        busy={busy}
        error={computed(() => (renameDialog.value ? operationError.value : null))}
        onSubmit={(id, name) => void rename(id, name)}
        onClose={() => { renameDialog.value = null; operationError.value = null; }}
      />
      <ComposerExportDialog
        open={computed(() => exportDialog.value !== null)}
        onClose={() => { exportDialog.value = null; }}
        documentName={computed(() => exportDialog.value?.name ?? "")}
        result={computed(() => {
          const current = exportDialog.value;
          return current?.outcome.status === "ready" ? current.outcome.generation : null;
        })}
        copyOutcome={computed(() => exportDialog.value?.outcome ?? null)}
      />
      <ConfirmDialog {...confirm.dialogProps} />
    </LibraryPage>
  );
}

export default CompositionLibrary;
