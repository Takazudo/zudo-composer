"use client";

/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import { Fragment } from "preact";
import type { JSX } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
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
} from "../../../components/library-page";
import { ConfirmDialog, Dialog, Menu, MenuRadioItem, useMenu } from "../../../components/overlay";
import { Banner, Button, Field, Input } from "../../../components/ui";
import { formatComposerRoute } from "../routing";
import { ComposerExportDialog } from "../ui/export/export-dialog";
import { NewCompositionDialog } from "./new-composition-dialog";
import type {
  CompositionLibraryCreateIntent,
  CompositionLibraryIntents,
  CompositionLibraryProviderCapability,
} from "./library-contract";

export interface CompositionLibraryProps {
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
}

type RenameDialogState = { id: string; name: string } | null;

type ExportDialogState =
  | { name: string; outcome: BrowserJsxExportOutcome }
  | null;

function message(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

/** One stable empty list, so the query and selection hooks see a stable input. */
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
  activeProviderId: CompositionProviderId;
  disabled?: boolean;
  onChange: (providerId: CompositionProviderId) => void;
}): JSX.Element | null {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menu = useMenu(triggerRef, { align: "end" });
  if (providers.length === 0) return null;
  const active = providers.find(({ descriptor }) => descriptor.id === activeProviderId) ?? providers[0]!;

  return (
    <Fragment>
      <button
        type="button"
        ref={triggerRef}
        class="cms-btn cms-btn--sm"
        disabled={disabled}
        {...menu.triggerProps}
      >
        <span>{`Provider: ${active.descriptor.label}`}</span>
        <ChevronDownIcon size="xs" class="cms-library-toolbar__caret" />
      </button>
      <Menu controller={menu} label="Provider">
        {providers.map(({ descriptor }) => (
          <MenuRadioItem
            key={descriptor.id}
            checked={descriptor.id === activeProviderId}
            onSelect={() => {
              if (descriptor.id !== activeProviderId) onChange(descriptor.id);
            }}
          >
            {descriptor.label}
          </MenuRadioItem>
        ))}
      </Menu>
    </Fragment>
  );
}

// The one naming question outside creation — renaming a stored composition —
// on the shared `Dialog`. State resets during the opening RENDER, not an
// effect: see new-composition-dialog.tsx for why that distinction matters.
function CompositionRenameDialog({
  state,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  state: RenameDialogState;
  busy: boolean;
  error: string | null;
  onSubmit: (id: string, name: string) => void;
  onClose: () => void;
}): JSX.Element {
  const fieldRef = useRef<HTMLInputElement | null>(null);
  const open = state !== null;
  const [value, setValue] = useState(state?.name ?? "");
  const [missing, setMissing] = useState(false);
  const wasOpen = useRef(open);
  if (open !== wasOpen.current) {
    wasOpen.current = open;
    if (open) {
      setValue(state!.name);
      setMissing(false);
    }
  }

  function submit(): void {
    if (busy || !state) return;
    const next = value.trim();
    if (next === "") {
      setMissing(true);
      return;
    }
    setMissing(false);
    onSubmit(state.id, next);
  }

  return (
    <Dialog
      open={open}
      title="Rename composition"
      initialFocusRef={fieldRef}
      dismissOnBackdrop={!busy}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <button type="button" class="cms-dialog__action" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" class="cms-dialog__action cms-dialog__action--primary" disabled={busy} onClick={submit}>
            {busy ? "Saving…" : "Save name"}
          </button>
        </>
      }
    >
      <p class="cms-dialog__message">{state ? `Choose a new name for ${state.name}.` : null}</p>
      {error ? <Banner tone="err">{error}</Banner> : null}
      <Field label="Name" error={missing ? "Enter a composition name." : undefined}>
        <Input
          elementRef={fieldRef}
          value={value}
          disabled={busy}
          onInput={(event) => {
            setMissing(false);
            setValue(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            submit();
          }}
        />
      </Field>
    </Dialog>
  );
}

export function CompositionLibrary({
  providers,
  initialProviderId,
  intents,
  onInitializationApplied,
  openNewOnMount = false,
  onOpenNewConsumed,
}: CompositionLibraryProps): JSX.Element {
  const availableProviders = useMemo(() => providers.filter((provider) => provider.available), [providers]);
  const [activeProviderId, setActiveProviderId] = useState<CompositionProviderId>(
    () => availableProviders.find(({ descriptor }) => descriptor.id === initialProviderId)?.descriptor.id
      ?? availableProviders[0]?.descriptor.id
      ?? initialProviderId,
  );
  const [outcome, setOutcome] = useState<CompositionInitializationOutcome | null>(null);
  const [busy, setBusy] = useState(availableProviders.length > 0);
  const [operationError, setOperationError] = useState<string | null>(
    availableProviders.length === 0 ? "No composition storage provider is available." : null,
  );
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [renameDialog, setRenameDialog] = useState<RenameDialogState>(null);
  const [exportDialog, setExportDialog] = useState<ExportDialogState>(null);

  const startedRef = useRef(false);
  const createdForNavigationRef = useRef<CompositionSummary | null>(null);

  // Always commits the result — including a returned "error" status — so a
  // retry against the SAME provider replaces a stale description with the
  // fresh one. Only a thrown exception goes to `operationError` instead.
  const load = useCallback(
    async (providerId: CompositionProviderId, mode: "initialize" | "retry" | "startFresh") => {
      setBusy(true);
      setOperationError(null);
      try {
        const result = await intents[mode](providerId);
        setActiveProviderId(providerId);
        setOutcome(result);
        if (result.status !== "error") onInitializationApplied?.(providerId, result);
        return result.status !== "error";
      } catch (reason) {
        setOperationError(message(reason, "The composition library could not be loaded."));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [intents, onInitializationApplied],
  );

  // Switching providers is different: a failure must leave the previously
  // active provider and its already-displayed rows exactly as they were,
  // rather than replacing them with the new provider's error.
  const switchProvider = useCallback(
    async (providerId: CompositionProviderId) => {
      if (providerId === activeProviderId || busy) return;
      setBusy(true);
      setOperationError(null);
      try {
        const result = await intents.initialize(providerId);
        if (result.status === "error") {
          setOperationError(result.error.message);
          return;
        }
        setActiveProviderId(providerId);
        setOutcome(result);
        onInitializationApplied?.(providerId, result);
      } catch (reason) {
        setOperationError(message(reason, "The composition library could not be loaded."));
      } finally {
        setBusy(false);
      }
    },
    [activeProviderId, busy, intents, onInitializationApplied],
  );

  useEffect(() => {
    if (startedRef.current || availableProviders.length === 0) return;
    startedRef.current = true;
    void load(activeProviderId, "initialize");
    // Runs once, against the provider resolved at mount.
  }, []);

  useEffect(() => {
    if (!openNewOnMount) return;
    setOperationError(null);
    setNewDialogOpen(true);
    onOpenNewConsumed?.();
    // Runs once: `openNewOnMount` is a one-shot route intent, not a toggle.
  }, []);

  const summaries = outcome?.status === "ready" ? outcome.summaries : NO_SUMMARIES;
  const ready = outcome?.status === "ready";
  const query = useLibraryQuery({
    rows: summaries,
    searchText: (row) => `${row.name} ${row.id}`,
    facets: FACETS,
    sorts: SORTS,
  });
  const selection = useLibrarySelection({ rows: summaries, visibleRows: query.rows, rowId: (row) => row.id });
  const confirm = useLibraryConfirm();

  const commitSummary = (summary: CompositionSummary): void => {
    setOutcome((current) => (current?.status === "ready"
      ? { ...current, summaries: sortByUpdated([summary, ...current.summaries.filter((item) => item.id !== summary.id)]) }
      : current));
  };

  const addSummaries = (created: readonly CompositionSummary[]): void => {
    if (created.length === 0) return;
    setOutcome((current) => (current?.status === "ready"
      ? { ...current, summaries: sortByUpdated([...current.summaries, ...created]) }
      : current));
  };

  const dropSummaries = (ids: ReadonlySet<string>): void => {
    setOutcome((current) => (current?.status === "ready"
      ? { ...current, summaries: current.summaries.filter((item) => !ids.has(item.id)) }
      : current));
  };

  // Opens a just-created (or just-duplicated) record and reports whether that
  // succeeded, without ever pretending the record itself was not saved.
  async function openCreatedComposition(
    created: CompositionSummary,
  ): Promise<{ status: "created" } | { status: "navigation-error"; message: string }> {
    try {
      const opened = await intents.open({ providerId: activeProviderId, recordId: created.id });
      if (opened.status === "not-found") {
        return { status: "navigation-error", message: "The new composition was saved but could not be opened because it was not found." };
      }
      createdForNavigationRef.current = null;
      setNewDialogOpen(false);
      return { status: "created" };
    } catch (reason) {
      return {
        status: "navigation-error",
        message: `The new composition was saved, but opening failed. ${message(reason, "")}`.trim(),
      };
    }
  }

  async function rename(id: string, name: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    setOperationError(null);
    try {
      const updated = await intents.rename({ providerId: activeProviderId, recordId: id }, name);
      commitSummary(updated);
      setRenameDialog(null);
    } catch (reason) {
      setOperationError(message(reason, "The composition could not be renamed."));
    } finally {
      setBusy(false);
    }
  }

  async function duplicateRow(id: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    setOperationError(null);
    try {
      const created = await intents.duplicate({ providerId: activeProviderId, recordId: id });
      commitSummary(created);
      try {
        const opened = await intents.open({ providerId: activeProviderId, recordId: created.id });
        if (opened.status === "not-found") {
          setOperationError("The duplicate was saved but could not be opened because it was not found.");
        }
      } catch (reason) {
        setOperationError(`The duplicate was saved, but opening failed. ${message(reason, "")}`.trim());
      }
    } catch (reason) {
      setOperationError(message(reason, "The composition could not be duplicated."));
    } finally {
      setBusy(false);
    }
  }

  async function duplicateBulk(ids: readonly string[]): Promise<void> {
    if (busy) return;
    setBusy(true);
    setOperationError(null);
    const created: CompositionSummary[] = [];
    try {
      for (const id of ids) {
        created.push(await intents.duplicate({ providerId: activeProviderId, recordId: id }));
      }
    } catch (reason) {
      setOperationError(message(reason, "The compositions could not be duplicated."));
    } finally {
      addSummaries(created);
      if (created.length > 0) selection.clear();
      setBusy(false);
    }
  }

  async function remove(ids: readonly string[]): Promise<void> {
    setBusy(true);
    setOperationError(null);
    // Deletions are reported one by one: a bulk delete that fails halfway must
    // still drop the records that are actually gone, or the list lies.
    const deleted = new Set<string>();
    try {
      for (const id of ids) {
        const ok = await intents.delete({ providerId: activeProviderId, recordId: id });
        if (ok) deleted.add(id);
      }
      if (deleted.size < ids.length) {
        setOperationError("Some compositions were not found, so they could not be deleted. The library list has been preserved.");
      }
    } catch (reason) {
      setOperationError(message(reason, "The composition could not be deleted."));
    } finally {
      if (deleted.size > 0) {
        dropSummaries(deleted);
        selection.clear();
      }
      setBusy(false);
    }
  }

  async function clearLibrary(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setOperationError(null);
    try {
      await intents.clear(activeProviderId);
      setOutcome({ status: "ready", summaries: [] });
      selection.clear();
    } catch (reason) {
      setOperationError(message(reason, "The compositions could not be cleared."));
    } finally {
      setBusy(false);
    }
  }

  async function exportRow(row: CompositionSummary): Promise<void> {
    setOperationError(null);
    try {
      const exported = await intents.exportJsx({ providerId: activeProviderId, recordId: row.id });
      setExportDialog({ name: exported.documentName, outcome: exported.outcome });
    } catch (reason) {
      setOperationError(message(reason, "The composition could not be exported."));
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
      message: `Delete all ${summaries.length} compositions? This cannot be undone.`,
      confirmLabel: "Clear library",
      tone: "danger",
      onConfirm: () => void clearLibrary(),
    });
  }

  function startCreate(): void {
    setOperationError(null);
    setNewDialogOpen(true);
  }

  const contract = useMemo<LibraryRowContract<CompositionSummary>>(() => ({
    id: (row) => row.id,
    name: (row) => row.name,
    icon: () => ComposerIcon,
    href: (row) => formatComposerRoute({ kind: "detail", providerId: activeProviderId, recordId: row.id }),
    kind: kindTag,
    updatedAt: (row) => row.updatedAt,
  }), [activeProviderId]);

  // The header action and the empty state's call to action are the same
  // command, but not the same control: two "New composition" buttons on one
  // screen is an ambiguity for pointer and screen-reader users alike.
  const newComposition = (
    <Button variant="primary" disabled={busy} onClick={startCreate}>
      <PlusIcon size="sm" />
      New composition
    </Button>
  );

  const activeLabel = (providers.find(({ descriptor }) => descriptor.id === activeProviderId) ?? availableProviders[0])?.descriptor.label
    ?? "Unavailable";

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
          disabled={busy || availableProviders.length === 0}
          onChange={(providerId) => void switchProvider(providerId)}
        />
      )}
      primaryAction={newComposition}
    >
      {operationError ? <Banner tone="err">{operationError}</Banner> : null}
      {outcome?.status === "error" ? (
        <LibraryUnavailableBanner
          title="Composition library unavailable."
          description={outcome.error.message}
          onRetry={() => void load(activeProviderId, "retry")}
        />
      ) : null}
      {outcome?.status === "recovery-required" ? (
        <LibraryRecoveryBanner
          title="Stored compositions need recovery."
          description={`${outcome.recovery.message} The original source has been preserved.`}
          onRetry={() => void load(activeProviderId, "retry")}
          onStartFresh={() => confirm.request({
            title: "Start fresh?",
            message: "Every stored composition is permanently deleted, including the ones that still read correctly.",
            confirmLabel: "Start fresh",
            tone: "danger",
            onConfirm: () => void load(activeProviderId, "startFresh"),
          })}
        />
      ) : null}
      {outcome === null && availableProviders.length > 0 ? (
        <LibrarySkeleton columns={4} label="Loading compositions…" />
      ) : null}
      {ready && summaries.length === 0 ? (
        <LibraryEmpty
          icon={ComposerIcon}
          title="No compositions yet"
          description="A composition is a reusable page structure built from the provider components."
          action={
            <Button variant="primary" disabled={busy} onClick={startCreate}>
              <PlusIcon size="sm" />
              Create your first composition
            </Button>
          }
        />
      ) : null}
      {ready && summaries.length > 0 ? (
        <>
          <LibraryToolbar
            query={query}
            searchLabel="Filter compositions"
            searchPlaceholder="Filter by name or ID"
            end={
              <Button size="sm" variant="ghost" disabled={busy} onClick={askClear}>
                <TrashIcon size="sm" />
                Clear library
              </Button>
            }
          />
          <LibraryTable
            caption="Compositions"
            rows={query.rows}
            contract={contract}
            columns={[{ key: "nodes", header: "Nodes", variant: "num", cell: (row) => row.nodeCount }]}
            selection={selection}
            empty={<LibraryNoMatch search={query.search} onClearFilters={query.clearFilters} />}
            bulkBar={selection.selectedCount > 0 ? (
              <BulkBar
                count={selection.selectedCount}
                describeCount={(count) => `${count} ${count === 1 ? "composition" : "compositions"} selected`}
                actions={[
                  {
                    id: "duplicate",
                    label: "Duplicate",
                    icon: DuplicateIcon,
                    onSelect: () => void duplicateBulk(selection.selectedRows.map((row) => row.id)),
                  },
                  {
                    id: "delete",
                    label: "Delete",
                    icon: TrashIcon,
                    tone: "danger",
                    onSelect: () => askDelete(selection.selectedRows.map((row) => row.name), selection.selectedRows.map((row) => row.id)),
                  },
                ]}
                onClear={selection.clear}
              />
            ) : undefined}
            rowMenu={(row) => ({
              label: row.name,
              open: { id: "open", label: "Open", kbd: "↵", href: contract.href!(row) },
              actions: [
                {
                  id: "rename",
                  label: "Rename…",
                  icon: EditIcon,
                  onSelect: () => { setOperationError(null); setRenameDialog({ id: row.id, name: row.name }); },
                },
                { id: "duplicate", label: "Duplicate", icon: DuplicateIcon, onSelect: () => void duplicateRow(row.id) },
                { id: "export", label: "Export JSX", icon: DownloadIcon, onSelect: () => void exportRow(row) },
              ],
              destructive: [
                { id: "delete", label: "Delete…", icon: TrashIcon, onSelect: () => askDelete([row.name], [row.id]) },
              ],
            })}
          />
          <LibraryPagination summary={`${query.rows.length} of ${summaries.length} compositions · ${activeLabel}`} />
        </>
      ) : null}
      <NewCompositionDialog
        open={newDialogOpen}
        providerId={activeProviderId}
        intents={intents}
        onSubmit={async (intent: CompositionLibraryCreateIntent) => {
          let created: CompositionSummary;
          try {
            created = await intents.create(intent);
          } catch (reason) {
            return { status: "create-error" as const, message: message(reason, "The composition could not be created.") };
          }
          commitSummary(created);
          createdForNavigationRef.current = created;
          return openCreatedComposition(created);
        }}
        onRetryNavigation={async () => {
          const created = createdForNavigationRef.current;
          return created
            ? openCreatedComposition(created)
            : { status: "navigation-error" as const, message: "There is no saved composition to retry opening." };
        }}
        onClose={() => { createdForNavigationRef.current = null; setNewDialogOpen(false); }}
      />
      <CompositionRenameDialog
        state={renameDialog}
        busy={busy}
        error={renameDialog ? operationError : null}
        onSubmit={(id, name) => void rename(id, name)}
        onClose={() => { setRenameDialog(null); setOperationError(null); }}
      />
      <ComposerExportDialog
        open={exportDialog !== null}
        onClose={() => setExportDialog(null)}
        documentName={exportDialog?.name ?? ""}
        result={exportDialog?.outcome.status === "ready" ? exportDialog.outcome.generation : null}
        copyOutcome={exportDialog?.outcome ?? null}
      />
      <ConfirmDialog {...confirm.dialogProps} />
    </LibraryPage>
  );
}

export default CompositionLibrary;
