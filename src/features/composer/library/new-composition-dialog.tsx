/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ReuseCatalogEntry } from "../../../composer/browser";
import { ComposerIcon, FileIcon, RefreshIcon, SearchIcon } from "../../../components/icons";
import { Dialog } from "../../../components/overlay";
import { Banner, Button, Chip, Field, Input, cx } from "../../../components/ui";
import type {
  CompositionLibraryCreateIntent,
  CompositionLibraryIntents,
} from "./library-contract";

export type NewCompositionDialogSubmitResult =
  | { status: "created" }
  | { status: "create-error"; message: string }
  | { status: "navigation-error"; message: string };

export interface NewCompositionDialogProps {
  open: boolean;
  providerId: CompositionLibraryCreateIntent["providerId"] | null;
  intents: Pick<CompositionLibraryIntents, "listTemplates">;
  onSubmit(intent: CompositionLibraryCreateIntent): Promise<NewCompositionDialogSubmitResult>;
  onRetryNavigation(): Promise<NewCompositionDialogSubmitResult>;
  onClose(): void;
}

type CatalogState =
  | { status: "loading"; entries: readonly ReuseCatalogEntry[] }
  | { status: "listed"; entries: readonly ReuseCatalogEntry[] }
  | { status: "error"; entries: readonly ReuseCatalogEntry[]; message: string };

type SubmissionState =
  | { status: "idle" }
  | { status: "busy" }
  | { status: "create-error"; message: string }
  | { status: "navigation-error"; message: string };

function formatTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(timestamp),
  );
}

function sameSource(a: ReuseCatalogEntry | null, b: ReuseCatalogEntry): boolean {
  return a?.ref.providerId === b.ref.providerId && a.ref.recordId === b.ref.recordId && a.outlet?.id === b.outlet?.id;
}

function submissionMessage(result: Exclude<NewCompositionDialogSubmitResult, { status: "created" }>): string {
  return result.message || "The composition could not be created.";
}

/**
 * The New-composition dialog on the shared `Dialog`: a name field and a
 * Global-template picker that keeps the record an empty local document,
 * binding only the chosen source and outlet.
 */
export function NewCompositionDialog({
  open,
  providerId,
  intents,
  onSubmit,
  onRetryNavigation,
  onClose,
}: NewCompositionDialogProps): JSX.Element {
  const nameRef = useRef<HTMLInputElement | null>(null);
  const requestRef = useRef(0);
  const submissionInFlightRef = useRef(false);
  const [name, setName] = useState("Untitled composition");
  const [query, setQuery] = useState("");
  const [selectedSource, setSelectedSource] = useState<ReuseCatalogEntry | null>(null);
  const [catalog, setCatalog] = useState<CatalogState>({ status: "loading", entries: [] });
  const [submission, setSubmission] = useState<SubmissionState>({ status: "idle" });

  // Reset during the opening render, not in an effect — see the Sitemapper
  // name dialog for why: an effect runs after paint, leaving a frame where
  // the dialog is visible and typeable before the reset lands.
  const wasOpen = useRef(open);
  if (open !== wasOpen.current) {
    wasOpen.current = open;
    if (open) {
      setName("Untitled composition");
      setQuery("");
      setSelectedSource(null);
      setSubmission({ status: "idle" });
      submissionInFlightRef.current = false;
    } else {
      requestRef.current += 1;
    }
  }

  const templateEntries = useMemo(
    () => catalog.entries.filter((entry) => entry.kind === "global-template" && entry.outlet !== undefined),
    [catalog.entries],
  );
  const filteredTemplates = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return templateEntries;
    return templateEntries.filter((entry) =>
      `${entry.summary.name} ${entry.outlet?.label ?? ""}`.toLocaleLowerCase().includes(normalized),
    );
  }, [query, templateEntries]);
  const busy = submission.status === "busy";
  const formLocked = busy || submission.status === "navigation-error";

  async function loadTemplates(): Promise<void> {
    if (!providerId) return;
    const request = ++requestRef.current;
    setCatalog((current) => ({ status: "loading", entries: current.entries }));
    try {
      const outcome = await intents.listTemplates(providerId);
      if (request !== requestRef.current) return;
      if (outcome.status === "listed") {
        setCatalog({ status: "listed", entries: outcome.entries });
      } else {
        setCatalog({ status: "error", entries: [], message: outcome.message });
      }
    } catch (reason) {
      if (request !== requestRef.current) return;
      setCatalog({
        status: "error",
        entries: [],
        message: reason instanceof Error ? reason.message : "Global templates could not be loaded.",
      });
    }
  }

  useEffect(() => {
    if (open) void loadTemplates();
    // `providerId` is included for a controlled re-open under a new provider.
  }, [open, providerId]);

  useEffect(() => {
    if (!selectedSource) return;
    if (!templateEntries.some((entry) => sameSource(selectedSource, entry))) {
      setSelectedSource(null);
    }
  }, [selectedSource, templateEntries]);

  async function submit(): Promise<void> {
    if (!providerId || formLocked || submissionInFlightRef.current) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setSubmission({ status: "create-error", message: "Give the composition a name before creating it." });
      nameRef.current?.focus();
      return;
    }
    submissionInFlightRef.current = true;
    setSubmission({ status: "busy" });
    try {
      const result = await onSubmit({
        providerId,
        name: trimmedName,
        ...(selectedSource
          ? { source: { sourceRecordId: selectedSource.ref.recordId, outletId: selectedSource.outlet!.id } }
          : {}),
      });
      if (result.status === "created") return;
      setSubmission({ status: result.status, message: submissionMessage(result) });
    } catch (reason) {
      setSubmission({
        status: "create-error",
        message: reason instanceof Error ? reason.message : "The composition could not be created.",
      });
    } finally {
      submissionInFlightRef.current = false;
    }
  }

  async function retry(): Promise<void> {
    if (busy || submissionInFlightRef.current) return;
    if (submission.status !== "navigation-error") {
      await submit();
      return;
    }
    submissionInFlightRef.current = true;
    setSubmission({ status: "busy" });
    try {
      const result = await onRetryNavigation();
      if (result.status === "created") return;
      setSubmission({ status: result.status, message: submissionMessage(result) });
    } catch (reason) {
      setSubmission({
        status: "navigation-error",
        message: reason instanceof Error ? reason.message : "Opening the new composition failed.",
      });
    } finally {
      submissionInFlightRef.current = false;
    }
  }

  return (
    <Dialog
      open={open}
      title="New composition"
      size="wide"
      initialFocusRef={nameRef}
      dismissOnBackdrop={!formLocked}
      onClose={() => {
        if (!formLocked) onClose();
      }}
      footer={
        <>
          <span class="mr-auto text-small text-muted" role="status">
            {busy ? "Saving composition…" : selectedSource ? `Binding to ${selectedSource.summary.name}.` : "Creating an ordinary composition."}
          </span>
          <button type="button" class="cms-dialog__action" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            class="cms-dialog__action cms-dialog__action--primary"
            disabled={formLocked}
            onClick={() => void submit()}
          >
            {busy ? "Creating…" : "Create composition"}
          </button>
        </>
      }
    >
      <p class="cms-dialog__message">Create an empty composition or bind its outlet to a Global template.</p>
      {submission.status !== "idle" && submission.status !== "busy" ? (
        <Banner tone="err" action={<Button size="sm" onClick={() => void retry()}><RefreshIcon size="sm" />Retry</Button>}>
          {submission.message}
        </Banner>
      ) : null}

      <Field label="Name">
        <Input
          elementRef={nameRef}
          value={name}
          disabled={formLocked}
          onInput={(event) => setName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            void submit();
          }}
        />
      </Field>

      <div class="mt-vsp-md flex min-h-0 flex-col gap-vsp-xs">
        <div class="flex flex-wrap items-end justify-between gap-hsp-sm">
          <span class="cms-field__label-text">Global template</span>
          <Input
            size="sm"
            type="search"
            icon={SearchIcon}
            class="min-w-48 flex-1"
            aria-label="Search Global templates"
            placeholder="Search templates…"
            value={query}
            disabled={formLocked || catalog.status !== "listed"}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </div>

        {catalog.status === "loading" ? (
          <p class="text-small text-muted" role="status">Loading Global templates…</p>
        ) : catalog.status === "error" ? (
          <Banner tone="err" action={<Button size="sm" disabled={formLocked} onClick={() => void loadTemplates()}><RefreshIcon size="sm" />Retry templates</Button>}>
            {catalog.message}
          </Banner>
        ) : (
          <div class="grid grid-cols-1 gap-hsp-sm sm:grid-cols-2" aria-label="Start from">
            <button
              type="button"
              class={cx(
                "flex flex-col items-start gap-vsp-3xs rounded-md border px-hsp-sm py-vsp-xs text-left text-small",
                selectedSource === null ? "border-accent bg-accent/10" : "border-border-strong bg-bg",
              )}
              aria-pressed={selectedSource === null}
              disabled={formLocked}
              onClick={() => setSelectedSource(null)}
            >
              <span class="inline-flex items-center gap-hsp-xs font-semibold text-fg"><FileIcon size="sm" />Blank document</span>
              <span class="text-muted">Empty root. Add the first component from the canvas.</span>
            </button>
            {filteredTemplates.map((entry) => (
              <button
                key={`${entry.ref.providerId}:${entry.ref.recordId}:${entry.outlet!.id}`}
                type="button"
                class={cx(
                  "flex flex-col items-start gap-vsp-3xs rounded-md border px-hsp-sm py-vsp-xs text-left text-small",
                  sameSource(selectedSource, entry) ? "border-accent bg-accent/10" : "border-border-strong bg-bg",
                )}
                aria-pressed={sameSource(selectedSource, entry)}
                disabled={formLocked}
                onClick={() => setSelectedSource(entry)}
              >
                <span class="inline-flex flex-wrap items-center gap-hsp-xs font-semibold text-fg">
                  <ComposerIcon size="sm" />
                  {entry.summary.name}
                  <Chip tone="accent">Global template</Chip>
                </span>
                <span class="text-muted">
                  Outlet: {entry.outlet!.label || entry.outlet!.id} · Updated {formatTimestamp(entry.summary.updatedAt)}
                </span>
              </button>
            ))}
            {templateEntries.length === 0 ? (
              <p class="text-small text-muted">No eligible Global templates are available from this provider.</p>
            ) : filteredTemplates.length === 0 ? (
              <p class="text-small text-muted">
                No Global templates match this search.{" "}
                <Button size="sm" variant="ghost" onClick={() => setQuery("")}>Clear search</Button>
              </p>
            ) : null}
          </div>
        )}
      </div>
    </Dialog>
  );
}
