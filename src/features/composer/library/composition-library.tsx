/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import {
  compareCompositionSummariesNewestFirst,
  type CompositionInitializationOutcome,
  type CompositionProviderId,
  type CompositionRecoveryOutcome,
  type CompositionSummary,
} from "../../../composer";
import { InlineConfirm } from "../ui/shared/inline-confirm";
import {
  NewCompositionDialog,
  type NewCompositionDialogSubmitResult,
} from "./new-composition-dialog";
import type {
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
}

type BusyOperation =
  | "loading"
  | "creating"
  | "opening"
  | "duplicating"
  | "deleting"
  | "clearing"
  | "recovering";

type Confirmation =
  | { kind: "delete"; id: string }
  | { kind: "clear" }
  | { kind: "start-fresh" };

const BUSY_MESSAGES: Record<BusyOperation, string> = {
  loading: "Loading compositions…",
  creating: "Creating and saving composition…",
  opening: "Opening composition…",
  duplicating: "Duplicating and saving composition…",
  deleting: "Deleting composition…",
  clearing: "Clearing compositions…",
  recovering: "Recovering composition library…",
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function sortSummaries(summaries: readonly CompositionSummary[]): CompositionSummary[] {
  return [...summaries].sort(compareCompositionSummariesNewestFirst);
}

function formatTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function publicationLabel(summary: CompositionSummary): string | null {
  if (summary.publicationKind === "global-template") {
    return summary.outletLabel
      ? `Global template · ${summary.outletLabel}`
      : "Global template";
  }
  return summary.publicationKind === "pattern" ? "Pattern · Saved composition" : null;
}

function focusAfterRender(getTarget: () => HTMLElement | null): void {
  setTimeout(() => getTarget()?.focus(), 0);
}

export function CompositionLibrary({
  providers,
  initialProviderId,
  intents,
  onInitializationApplied,
}: CompositionLibraryProps): JSX.Element {
  const availableProviders = useMemo(
    () => providers.filter((provider) => provider.available),
    [providers],
  );
  const initialProvider =
    availableProviders.find(({ descriptor }) => descriptor.id === initialProviderId) ??
    availableProviders[0];

  const [activeProviderId, setActiveProviderId] = useState<CompositionProviderId | null>(
    initialProvider?.descriptor.id ?? null,
  );
  const [summaries, setSummaries] = useState<CompositionSummary[]>([]);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<BusyOperation | null>(initialProvider ? "loading" : null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(
    initialProvider ? null : "No composition storage provider is available.",
  );
  const [announcement, setAnnouncement] = useState("");
  const [recovery, setRecovery] = useState<CompositionRecoveryOutcome | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [newDialogOpen, setNewDialogOpen] = useState(false);

  const startedRef = useRef(false);
  const newButtonRef = useRef<HTMLButtonElement | null>(null);
  const emptyNewButtonRef = useRef<HTMLButtonElement | null>(null);
  const clearButtonRef = useRef<HTMLButtonElement | null>(null);
  const clearFilterButtonRef = useRef<HTMLButtonElement | null>(null);
  const startFreshButtonRef = useRef<HTMLButtonElement | null>(null);
  const openButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const deleteButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const createdForNavigationRef = useRef<CompositionSummary | null>(null);

  const activeProvider = availableProviders.find(
    ({ descriptor }) => descriptor.id === activeProviderId,
  );

  const applyInitialization = useCallback(
    (
      providerId: CompositionProviderId,
      outcome: CompositionInitializationOutcome,
    ): boolean => {
      if (outcome.status === "error") {
        setError(outcome.error.message);
        setAnnouncement("Composition library operation failed.");
        return false;
      }

      try {
        onInitializationApplied?.(providerId, outcome);
      } catch {
        // Observers cannot turn a committed provider result into a false UI failure.
      }
      setActiveProviderId(providerId);
      setError(null);
      setLoaded(true);
      if (outcome.status === "recovery-required") {
        setSummaries([]);
        setRecovery(outcome.recovery);
        setAnnouncement("Composition library recovery is required.");
        return true;
      }

      setSummaries(sortSummaries(outcome.summaries));
      setRecovery(null);
      setAnnouncement("Composition library loaded.");
      return true;
    },
    [onInitializationApplied],
  );

  const loadProvider = useCallback(
    async (
      providerId: CompositionProviderId,
      mode: "initialize" | "retry" | "startFresh",
    ): Promise<boolean> => {
      setBusy(mode === "startFresh" ? "recovering" : "loading");
      setError(null);
      setAnnouncement(mode === "startFresh" ? "Starting fresh…" : "Loading compositions…");
      try {
        const outcome = await intents[mode](providerId);
        return applyInitialization(providerId, outcome);
      } catch (reason) {
        setError(errorMessage(reason, "The composition library could not be loaded."));
        setAnnouncement("Composition library operation failed.");
        return false;
      } finally {
        setBusy(null);
      }
    },
    [applyInitialization, intents],
  );

  useEffect(() => {
    if (startedRef.current || !initialProvider) return;
    startedRef.current = true;
    void loadProvider(initialProvider.descriptor.id, "initialize");
  }, [initialProvider, loadProvider]);

  const filteredSummaries = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase();
    if (!query) return summaries;
    return summaries.filter((summary) =>
      `${summary.name} ${summary.id}`.toLocaleLowerCase().includes(query),
    );
  }, [filter, summaries]);

  function rowRef(id: string) {
    return (element: HTMLButtonElement | null) => {
      if (element) openButtonRefs.current.set(id, element);
      else openButtonRefs.current.delete(id);
    };
  }

  function deleteRef(id: string) {
    return (element: HTMLButtonElement | null) => {
      if (element) deleteButtonRefs.current.set(id, element);
      else deleteButtonRefs.current.delete(id);
    };
  }

  async function openComposition(id: string): Promise<void> {
    if (!activeProviderId || busy) return;
    setBusy("opening");
    setError(null);
    setAnnouncement("Opening composition…");
    try {
      const outcome = await intents.open({ providerId: activeProviderId, recordId: id });
      if (outcome.status === "not-found") {
        setError(`“${summaries.find((item) => item.id === id)?.name ?? id}” was not found. The library list has been preserved.`);
        setAnnouncement("Composition was not found.");
      } else {
        setAnnouncement("Composition opened.");
      }
    } catch (reason) {
      setError(errorMessage(reason, "The composition could not be opened."));
      setAnnouncement("Opening composition failed.");
    } finally {
      setBusy(null);
    }
  }

  function openNewCompositionDialog(): void {
    if (!activeProviderId || busy || confirmation || recovery?.kind === "quarantined") return;
    createdForNavigationRef.current = null;
    setError(null);
    setAnnouncement("Choose how to create the new composition.");
    setNewDialogOpen(true);
  }

  async function openCreatedComposition(created: CompositionSummary): Promise<NewCompositionDialogSubmitResult> {
    if (!activeProviderId) {
      return { status: "navigation-error", message: "The active composition provider is unavailable." };
    }
    setBusy("opening");
    setAnnouncement("Composition saved. Opening it now.");
    try {
      const outcome = await intents.open({ providerId: activeProviderId, recordId: created.id });
      if (outcome.status === "not-found") {
        setAnnouncement("Composition was saved, but opening failed.");
        return {
          status: "navigation-error",
          message: "The new composition was saved but could not be opened because it was not found.",
        };
      }
      createdForNavigationRef.current = null;
      setAnnouncement("Composition created and opened.");
      return { status: "created" };
    } catch (reason) {
      setAnnouncement("Composition was saved, but opening failed.");
      return {
        status: "navigation-error",
        message: `The new composition was saved, but opening failed. ${errorMessage(reason, "")}`.trim(),
      };
    } finally {
      setBusy(null);
    }
  }

  async function submitNewComposition(
    intent: Parameters<typeof intents.create>[0],
  ): Promise<NewCompositionDialogSubmitResult> {
    if (busy) return { status: "create-error", message: "Another composition operation is still running." };
    setBusy("creating");
    setError(null);
    setAnnouncement("Creating and saving composition…");
    try {
      const created = await intents.create(intent);
      createdForNavigationRef.current = created;
      setSummaries((current) => sortSummaries([...current, created]));
      return await openCreatedComposition(created);
    } catch (reason) {
      const message = errorMessage(reason, "The composition could not be created.");
      setAnnouncement("Creating composition failed.");
      setBusy(null);
      return { status: "create-error", message };
    }
  }

  async function retryNewCompositionNavigation(): Promise<NewCompositionDialogSubmitResult> {
    const created = createdForNavigationRef.current;
    return created
      ? openCreatedComposition(created)
      : { status: "create-error", message: "There is no saved composition to retry opening." };
  }

  function closeNewCompositionDialog(): void {
    createdForNavigationRef.current = null;
    setNewDialogOpen(false);
  }

  async function duplicateComposition(id: string): Promise<void> {
    if (!activeProviderId || busy) return;
    setBusy("duplicating");
    setError(null);
    setAnnouncement("Duplicating and saving composition…");
    try {
      const created = await intents.duplicate({ providerId: activeProviderId, recordId: id });
      setSummaries((current) => sortSummaries([...current, created]));
      setBusy("opening");
      setAnnouncement("Composition duplicated. Opening the copy now.");
      try {
        const outcome = await intents.open({ providerId: activeProviderId, recordId: created.id });
        if (outcome.status === "not-found") {
          setError("The duplicate was saved but could not be opened because it was not found.");
          setAnnouncement("Composition was duplicated, but opening failed.");
        } else {
          setAnnouncement("Composition duplicated and opened.");
        }
      } catch (reason) {
        setError(`The duplicate was saved, but opening failed. ${errorMessage(reason, "")}`.trim());
        setAnnouncement("Composition was duplicated, but opening failed.");
      }
    } catch (reason) {
      setError(errorMessage(reason, "The composition could not be duplicated."));
      setAnnouncement("Duplicating composition failed.");
      focusAfterRender(() => openButtonRefs.current.get(id) ?? null);
    } finally {
      setBusy(null);
    }
  }

  function cancelConfirmation(): void {
    const previous = confirmation;
    setConfirmation(null);
    if (previous?.kind === "delete") {
      focusAfterRender(() => deleteButtonRefs.current.get(previous.id) ?? null);
    } else if (previous?.kind === "clear") {
      focusAfterRender(() => clearButtonRef.current);
    } else if (previous?.kind === "start-fresh") {
      focusAfterRender(() => startFreshButtonRef.current);
    }
  }

  async function confirmDelete(id: string): Promise<void> {
    if (!activeProviderId || busy) return;
    const oldVisibleIndex = filteredSummaries.findIndex((summary) => summary.id === id);
    setConfirmation(null);
    setBusy("deleting");
    setError(null);
    setAnnouncement("Deleting composition…");
    try {
      const deleted = await intents.delete({ providerId: activeProviderId, recordId: id });
      if (!deleted) {
        setError("The composition was not found, so nothing was deleted. The library list has been preserved.");
        setAnnouncement("Composition was not found.");
        focusAfterRender(() => deleteButtonRefs.current.get(id) ?? null);
        return;
      }
      const next = summaries.filter((summary) => summary.id !== id);
      const nextVisible = filteredSummaries.filter((summary) => summary.id !== id);
      setSummaries(next);
      setAnnouncement("Composition deleted.");
      const survivingId = nextVisible[Math.min(oldVisibleIndex, nextVisible.length - 1)]?.id;
      focusAfterRender(() =>
        survivingId
          ? openButtonRefs.current.get(survivingId) ?? null
          : next.length === 0
            ? emptyNewButtonRef.current
            : clearFilterButtonRef.current,
      );
    } catch (reason) {
      setError(errorMessage(reason, "The composition could not be deleted."));
      setAnnouncement("Deleting composition failed.");
      focusAfterRender(() => deleteButtonRefs.current.get(id) ?? null);
    } finally {
      setBusy(null);
    }
  }

  async function confirmClear(): Promise<void> {
    if (!activeProviderId || busy) return;
    setConfirmation(null);
    setBusy("clearing");
    setError(null);
    setAnnouncement("Clearing compositions…");
    try {
      await intents.clear(activeProviderId);
      setSummaries([]);
      setFilter("");
      setAnnouncement("All compositions cleared.");
      focusAfterRender(() => emptyNewButtonRef.current);
    } catch (reason) {
      setError(errorMessage(reason, "The compositions could not be cleared."));
      setAnnouncement("Clearing compositions failed.");
      focusAfterRender(() => clearButtonRef.current);
    } finally {
      setBusy(null);
    }
  }

  async function confirmStartFresh(): Promise<void> {
    if (!activeProviderId || busy) return;
    setConfirmation(null);
    const succeeded = await loadProvider(activeProviderId, "startFresh");
    focusAfterRender(() =>
      succeeded
        ? openButtonRefs.current.values().next().value ?? emptyNewButtonRef.current ?? newButtonRef.current
        : startFreshButtonRef.current,
    );
  }

  const liveMessage = busy ? BUSY_MESSAGES[busy] : announcement;
  const controlsDisabled = busy !== null || confirmation !== null || newDialogOpen;

  return (
    <main class="sg-composer-library" aria-labelledby="sg-composer-library-title" aria-busy={busy !== null}>
      <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {liveMessage}
      </p>
      <header class="sg-composer-library-header">
        <div class="sg-composer-library-heading">
          <p class="sg-composer-library-eyebrow">Composer</p>
          <h1 id="sg-composer-library-title">Composition library</h1>
          <p>Create, find, and reopen your compositions.</p>
        </div>
        <button
          ref={newButtonRef}
          type="button"
          class="sg-composer-library-button sg-composer-library-button-primary"
          disabled={!activeProviderId || controlsDisabled || recovery?.kind === "quarantined"}
          onClick={openNewCompositionDialog}
        >
          New composition
        </button>
      </header>

      <section class="sg-composer-library-storage" aria-labelledby="sg-composer-library-storage-title">
        <div>
          <h2 id="sg-composer-library-storage-title">Storage</h2>
          <p class="sg-composer-library-storage-identity">
            Active database: <strong>{activeProvider?.descriptor.storageLabel ?? "Unavailable"}</strong>
          </p>
        </div>
        <label class="sg-composer-library-provider">
          <span>Provider</span>
          <select
            value={activeProviderId ?? ""}
            disabled={controlsDisabled || availableProviders.length < 2}
            onChange={(event) => {
              const providerId = event.currentTarget.value as CompositionProviderId;
              if (providerId !== activeProviderId) void loadProvider(providerId, "initialize");
            }}
          >
            {availableProviders.map(({ descriptor }) => (
              <option key={descriptor.id} value={descriptor.id}>{descriptor.label}</option>
            ))}
          </select>
        </label>
      </section>

      {error && (
        <section class="sg-composer-library-alert sg-composer-library-alert-error" role="alert">
          <div>
            <h2>Something went wrong</h2>
            <p>{error}</p>
          </div>
          {activeProviderId && (
            <button
              type="button"
              class="sg-composer-library-button"
              disabled={controlsDisabled}
              onClick={() => void loadProvider(activeProviderId, "retry")}
            >
              Retry library
            </button>
          )}
        </section>
      )}

      {recovery && (
        <section class="sg-composer-library-alert" aria-labelledby="sg-composer-library-recovery-title">
          <div>
            <h2 id="sg-composer-library-recovery-title">
              {recovery.kind === "quarantined" ? "Recovery required" : "Recovery notice"}
            </h2>
            <p>{recovery.message}</p>
            <p>The original source has been preserved.</p>
          </div>
          {recovery.kind === "quarantined" && confirmation?.kind !== "start-fresh" && (
            <div class="sg-composer-library-actions">
              <button
                type="button"
                class="sg-composer-library-button"
                disabled={controlsDisabled}
                onClick={() => activeProviderId && void loadProvider(activeProviderId, "retry")}
              >
                Retry recovery
              </button>
              <button
                ref={startFreshButtonRef}
                type="button"
                class="sg-composer-library-button sg-composer-library-button-danger"
                disabled={controlsDisabled}
                onClick={() => setConfirmation({ kind: "start-fresh" })}
              >
                Start fresh
              </button>
            </div>
          )}
          {recovery.kind !== "quarantined" && (
            <button
              type="button"
              class="sg-composer-library-button"
              disabled={controlsDisabled}
              onClick={() => activeProviderId && void loadProvider(activeProviderId, "retry")}
            >
              Retry recovery
            </button>
          )}
          {confirmation?.kind === "start-fresh" && (
            <InlineConfirm
              tone="toolbar"
              ariaLabel="Confirm starting a fresh composition library"
              message="Start fresh? The preserved source will no longer be active."
              confirmLabel="Start fresh"
              onCancel={cancelConfirmation}
              onConfirm={() => void confirmStartFresh()}
            />
          )}
        </section>
      )}

      {!loaded && summaries.length === 0 ? (
        <section
          class="sg-composer-library-state"
          aria-label={busy === "loading" ? "Loading compositions" : "Composition library unavailable"}
        >
          <h2>{busy === "loading" ? "Loading compositions…" : "Composition library unavailable"}</h2>
          <p>
            {busy === "loading"
              ? "Your library will appear here shortly."
              : "Use Retry library above to try loading your compositions again."}
          </p>
        </section>
      ) : recovery?.kind !== "quarantined" ? (
        <section class="sg-composer-library-collection" aria-labelledby="sg-composer-library-collection-title">
          <div class="sg-composer-library-collection-tools">
            <div>
              <h2 id="sg-composer-library-collection-title">Compositions</h2>
              <p>{summaries.length} {summaries.length === 1 ? "composition" : "compositions"}</p>
            </div>
            <label class="sg-composer-library-filter">
              <span>Filter compositions</span>
              <input
                type="search"
                value={filter}
                disabled={controlsDisabled}
                onInput={(event) => setFilter(event.currentTarget.value)}
                placeholder="Name or ID"
              />
            </label>
            {summaries.length > 0 && confirmation?.kind !== "clear" && (
              <button
                ref={clearButtonRef}
                type="button"
                class="sg-composer-library-button sg-composer-library-button-danger"
                disabled={controlsDisabled}
                onClick={() => setConfirmation({ kind: "clear" })}
              >
                Clear library
              </button>
            )}
          </div>

          {confirmation?.kind === "clear" && (
            <InlineConfirm
              tone="toolbar"
              ariaLabel="Confirm clearing the composition library"
              message={`Delete all ${summaries.length} compositions?`}
              confirmLabel="Clear library"
              onCancel={cancelConfirmation}
              onConfirm={() => void confirmClear()}
            />
          )}

          {summaries.length === 0 ? (
            <div class="sg-composer-library-state">
              <h3>No compositions yet</h3>
              <p>Create your first composition to start building.</p>
              <button
                ref={emptyNewButtonRef}
                type="button"
                class="sg-composer-library-button sg-composer-library-button-primary"
                disabled={controlsDisabled}
                onClick={openNewCompositionDialog}
              >
                New composition
              </button>
            </div>
          ) : filteredSummaries.length === 0 ? (
            <div class="sg-composer-library-state">
              <h3>No matching compositions</h3>
              <p>Try another name or clear the filter.</p>
              <button
                ref={clearFilterButtonRef}
                type="button"
                class="sg-composer-library-button"
                onClick={() => setFilter("")}
              >
                Clear filter
              </button>
            </div>
          ) : (
            <ul class="sg-composer-library-list" aria-label="Composition results">
              {filteredSummaries.map((summary) => (
                <li key={summary.id} class="sg-composer-library-row">
                  <div class="sg-composer-library-row-main">
                    <button
                      ref={rowRef(summary.id)}
                      type="button"
                      class="sg-composer-library-open"
                      disabled={controlsDisabled}
                      aria-label={`Open ${summary.name}`}
                      onClick={() => void openComposition(summary.id)}
                    >
                      <span class="sg-composer-library-row-name">{summary.name}</span>
                      {publicationLabel(summary) && (
                        <span class="sg-composer-tree-badge" data-sg-composer-publication={summary.publicationKind}>
                          {publicationLabel(summary)}
                        </span>
                      )}
                      <span class="sg-composer-library-row-id">ID: {summary.id}</span>
                    </button>
                    <dl class="sg-composer-library-meta">
                      <div><dt>Updated</dt><dd><time dateTime={summary.updatedAt}>{formatTimestamp(summary.updatedAt)}</time></dd></div>
                      <div><dt>Created</dt><dd><time dateTime={summary.createdAt}>{formatTimestamp(summary.createdAt)}</time></dd></div>
                      <div><dt>Nodes</dt><dd>{summary.nodeCount}</dd></div>
                    </dl>
                  </div>
                  {confirmation?.kind === "delete" && confirmation.id === summary.id ? (
                    <InlineConfirm
                      tone="toolbar"
                      ariaLabel={`Confirm deleting ${summary.name}`}
                      message={`Delete “${summary.name}”?`}
                      confirmLabel="Delete composition"
                      onCancel={cancelConfirmation}
                      onConfirm={() => void confirmDelete(summary.id)}
                    />
                  ) : (
                    <div class="sg-composer-library-row-actions">
                      <button
                        type="button"
                        class="sg-composer-library-button"
                        disabled={controlsDisabled}
                        aria-label={`Duplicate ${summary.name}`}
                        onClick={() => void duplicateComposition(summary.id)}
                      >
                        Duplicate
                      </button>
                      <button
                        ref={deleteRef(summary.id)}
                        type="button"
                        class="sg-composer-library-button sg-composer-library-button-danger"
                        disabled={controlsDisabled}
                        aria-label={`Delete ${summary.name}`}
                        onClick={() => setConfirmation({ kind: "delete", id: summary.id })}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <NewCompositionDialog
        open={newDialogOpen}
        providerId={activeProviderId}
        intents={intents}
        onSubmit={submitNewComposition}
        onRetryNavigation={retryNewCompositionNavigation}
        onClose={closeNewCompositionDialog}
      />
    </main>
  );
}
