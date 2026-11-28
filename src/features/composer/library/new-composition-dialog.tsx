import { computed, For, getScope, Show, signal, type Child, type Ref } from "@takazudo/zfb/zudo-react";
import type { ComponentCatalog, GlobalTemplateOutletRule, ReuseCatalogEntry } from "../../../composer/browser";
import { ComposerIcon, FileIcon, RefreshIcon, SearchIcon } from "../../../components/icons";
import { Dialog } from "../../../components/overlay";
import { read, type MaybeSignal } from "../../../components/reactive";
import { Rebuild } from "../../../components/rebuild";
import { Banner, Button, Chip, Field, Input, cx } from "../../../components/ui";
import { Keyed } from "../../../runtime";
import type { ComponentDefinition } from "../active-pack";
import type {
  CompositionLibraryCreateIntent,
  CompositionLibraryIntents,
} from "./library-contract";

export type NewCompositionDialogSubmitResult =
  | { status: "created" }
  | { status: "create-error"; message: string }
  | { status: "navigation-error"; message: string };

export interface NewCompositionDialogProps {
  open: MaybeSignal<boolean>;
  providerId: MaybeSignal<CompositionLibraryCreateIntent["providerId"] | null>;
  intents: Pick<CompositionLibraryIntents, "listTemplates">;
  /** The single app-layer `createComponentCatalog(entries)` derivation — never re-derived here. */
  manifest: ComponentCatalog;
  /** The richer catalog backing id→title/"has rule" display, same array `manifest` was derived from. */
  entries: readonly ComponentDefinition[];
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

interface AcceptedKind {
  id: string;
  title: string;
  hasOwnRule: boolean;
}

/** The restricted outlet's accepted components, titled and flagged for their own nested rule. An id the catalog no longer offers is dropped, mirroring `partitionCatalog` in slot-rules.ts. */
function acceptedKinds(
  rule: GlobalTemplateOutletRule,
  catalogById: ReadonlyMap<string, ComponentDefinition>,
  manifest: ComponentCatalog,
): AcceptedKind[] {
  if (!rule.accepts) return [];
  return rule.accepts.flatMap((id) => {
    const definition = catalogById.get(id);
    if (!definition) return [];
    const hasOwnRule = manifest.get(id)?.slots.some((slot) => slot.accepts !== undefined) ?? false;
    return [{ id, title: definition.title, hasOwnRule }];
  });
}

/** "Accepts N kinds, at least M, any order:" — a `single` outlet drops "any order" since there is only one slot to fill. */
function describeAcceptedKindsLead(rule: Pick<GlobalTemplateOutletRule, "cardinality" | "min">, count: number): string {
  const kinds = `${count} kind${count === 1 ? "" : "s"}`;
  const atLeast = rule.min !== undefined && rule.min > 0 ? `, at least ${rule.min}` : "";
  const order = rule.cardinality === "single" ? "" : ", any order";
  return `Accepts ${kinds}${atLeast}${order}:`;
}

/** "{outletLabel} = {componentTitle} › {slotLabel}", falling back to the outlet label alone when the outlet target didn't resolve. */
function outletSummaryHeading(
  entry: ReuseCatalogEntry,
  manifest: ComponentCatalog,
  catalogById: ReadonlyMap<string, ComponentDefinition>,
): string {
  const outletLabel = entry.outlet?.label || entry.outlet?.id || "Outlet";
  const rule = entry.outletRule;
  if (!rule) return outletLabel;
  const componentTitle = catalogById.get(rule.componentId)?.title ?? rule.componentId;
  const slotLabel = manifest.get(rule.componentId)?.slots.find((slot) => slot.id === rule.slotId)?.label ?? rule.slotId;
  return `${outletLabel} = ${componentTitle} › ${slotLabel}`;
}

/**
 * The New-composition dialog on the shared `Dialog`: a name field and a
 * Global-template picker that keeps the record an empty local document,
 * binding only the chosen source and outlet.
 *
 * Each opening is a fresh session: its field state is set up before the dialog
 * can be seen or typed into, and closing invalidates any template read still
 * in flight.
 */
export function NewCompositionDialog(props: NewCompositionDialogProps): Child {
  const open = computed(() => read(props.open));
  return (
    <Keyed value={open} by={(isOpen) => (isOpen ? "open" : "closed")}>
      {(isOpen) => <NewCompositionSession {...props} open={isOpen.value} />}
    </Keyed>
  );
}

function NewCompositionSession({
  open,
  providerId: providerIdProp,
  intents,
  manifest,
  entries,
  onSubmit,
  onRetryNavigation,
  onClose,
}: Omit<NewCompositionDialogProps, "open"> & { open: boolean }): Child {
  const scope = getScope();
  const nameRef: Ref<HTMLInputElement> = { current: null };
  let request = 0;
  let submissionInFlight = false;
  const providerId = computed(() => read(providerIdProp));
  const name = signal("Untitled composition");
  const query = signal("");
  const selectedSource = signal<ReuseCatalogEntry | null>(null);
  const catalog = signal<CatalogState>({ status: "loading", entries: [] });
  const submission = signal<SubmissionState>({ status: "idle" });
  const catalogById = new Map(entries.map((definition) => [definition.id, definition]));
  scope.onCleanup(() => {
    request += 1;
  });

  const templateEntries = computed(() =>
    catalog.value.entries.filter((entry) => entry.kind === "global-template" && entry.outlet !== undefined),
  );
  const filteredTemplates = computed(() => {
    const normalized = query.value.trim().toLocaleLowerCase();
    if (!normalized) return templateEntries.value;
    return templateEntries.value.filter((entry) =>
      `${entry.summary.name} ${entry.outlet?.label ?? ""}`.toLocaleLowerCase().includes(normalized),
    );
  });
  const busy = computed(() => submission.value.status === "busy");
  const formLocked = computed(() => busy.value || submission.value.status === "navigation-error");

  async function loadTemplates(): Promise<void> {
    const currentProviderId = providerId.value;
    if (!currentProviderId) return;
    const current = ++request;
    catalog.value = { status: "loading", entries: catalog.value.entries };
    try {
      const outcome = await intents.listTemplates(currentProviderId);
      if (current !== request || scope.abortSignal.aborted) return;
      if (outcome.status === "listed") {
        catalog.value = { status: "listed", entries: outcome.entries };
      } else {
        catalog.value = { status: "error", entries: [], message: outcome.message };
      }
    } catch (reason) {
      if (current !== request || scope.abortSignal.aborted) return;
      catalog.value = {
        status: "error",
        entries: [],
        message: reason instanceof Error ? reason.message : "Global templates could not be loaded.",
      };
    }
  }

  // Read on open, and again for a controlled re-open under a new provider.
  let seenProviderId: string | null | undefined;
  const loadForProvider = () => {
    const current = providerId.value;
    if (Object.is(current, seenProviderId)) return;
    seenProviderId = current;
    if (open) void loadTemplates();
  };
  loadForProvider();
  scope.effect(loadForProvider);

  scope.effect(() => {
    const selected = selectedSource.value;
    if (!selected) return;
    if (!templateEntries.value.some((entry) => sameSource(selected, entry))) selectedSource.value = null;
  });

  async function submit(): Promise<void> {
    const currentProviderId = providerId.value;
    if (!currentProviderId || formLocked.value || submissionInFlight) return;
    const trimmedName = name.value.trim();
    if (!trimmedName) {
      submission.value = { status: "create-error", message: "Give the composition a name before creating it." };
      nameRef.current?.focus();
      return;
    }
    const source = selectedSource.value;
    submissionInFlight = true;
    submission.value = { status: "busy" };
    try {
      const result = await onSubmit({
        providerId: currentProviderId,
        name: trimmedName,
        ...(source
          ? { source: { sourceRecordId: source.ref.recordId, outletId: source.outlet!.id } }
          : {}),
      });
      if (result.status === "created" || scope.abortSignal.aborted) return;
      submission.value = { status: result.status, message: submissionMessage(result) };
    } catch (reason) {
      if (scope.abortSignal.aborted) return;
      submission.value = {
        status: "create-error",
        message: reason instanceof Error ? reason.message : "The composition could not be created.",
      };
    } finally {
      submissionInFlight = false;
    }
  }

  async function retry(): Promise<void> {
    if (busy.value || submissionInFlight) return;
    if (submission.value.status !== "navigation-error") {
      await submit();
      return;
    }
    submissionInFlight = true;
    submission.value = { status: "busy" };
    try {
      const result = await onRetryNavigation();
      if (result.status === "created" || scope.abortSignal.aborted) return;
      submission.value = { status: result.status, message: submissionMessage(result) };
    } catch (reason) {
      if (scope.abortSignal.aborted) return;
      submission.value = {
        status: "navigation-error",
        message: reason instanceof Error ? reason.message : "Opening the new composition failed.",
      };
    } finally {
      submissionInFlight = false;
    }
  }

  const footerStatus = computed(() => {
    if (busy.value) return "Saving composition…";
    const source = selectedSource.value;
    if (!source) return "Creating an ordinary composition.";
    return source.outletRule?.accepts
      ? `Binding to ${source.summary.name}. Pages of this kind are bound live to ${source.summary.name}; changing the rule in code changes every page bound to it.`
      : `Binding to ${source.summary.name}.`;
  });
  const submissionError = computed(() => {
    const current = submission.value;
    return current.status === "create-error" || current.status === "navigation-error" ? current.message : null;
  });
  const cardClass = (selected: boolean) => cx(
    "flex flex-col items-start gap-vsp-3xs rounded-md border px-hsp-sm py-vsp-xs text-left text-small",
    selected ? "border-accent bg-accent/10" : "border-border-strong bg-bg",
  );
  const blankSelected = computed(() => selectedSource.value === null);

  return (
    <Dialog
      open={open}
      title="New composition"
      size="wide"
      initialFocusRef={nameRef}
      dismissOnBackdrop={computed(() => !formLocked.value)}
      onClose={() => {
        if (!formLocked.value) onClose();
      }}
      footer={
        <>
          <span class="mr-auto text-small text-muted" role="status">{footerStatus}</span>
          <button type="button" class="cms-dialog__action" disabled={busy} on:click={onClose}>
            Cancel
          </button>
          <button
            type="button"
            class="cms-dialog__action cms-dialog__action--primary"
            disabled={formLocked}
            on:click={() => void submit()}
          >
            {computed(() => (busy.value ? "Creating…" : "Create composition"))}
          </button>
        </>
      }
    >
      <p class="cms-dialog__message">Create an empty composition or bind its outlet to a Global template.</p>
      <Show when={computed(() => submissionError.value !== null)}>
        {() => (
          <Banner tone="err" action={<Button size="sm" on:click={() => void retry()}><RefreshIcon size="sm" />Retry</Button>}>
            {computed(() => submissionError.value ?? "")}
          </Banner>
        )}
      </Show>

      <Field label="Name">
        {(field) => (
          <Input
            field={field}
            elementRef={nameRef}
            modelValue={name}
            disabled={formLocked}
            on:keydown={(event: KeyboardEvent) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              void submit();
            }}
          />
        )}
      </Field>

      <div class="mt-vsp-md flex min-h-0 flex-col gap-vsp-xs">
        <div class="flex flex-wrap items-end justify-between gap-hsp-sm">
          <span class="cms-field__label-text">Global template</span>
          <Input
            size="sm"
            type="search"
            icon={SearchIcon}
            // An arbitrary length, not `min-w-48`: this app's Tailwind theme
            // defines no base `--spacing`, so every numeric spacing utility
            // generates nothing. `scripts/check-class-names.mjs` guards that.
            class="min-w-[12rem] flex-1"
            aria-label="Search Global templates"
            placeholder="Search templates…"
            modelValue={query}
            disabled={computed(() => formLocked.value || catalog.value.status !== "listed")}
          />
        </div>

        <Keyed value={catalog} by={(current) => current.status}>
          {(current) => {
            if (current.value.status === "loading") {
              return <p class="text-small text-muted" role="status">Loading Global templates…</p>;
            }
            if (current.value.status === "error") {
              return (
                <Banner tone="err" action={<Button size="sm" disabled={formLocked} on:click={() => void loadTemplates()}><RefreshIcon size="sm" />Retry templates</Button>}>
                  {computed(() => (current.value.status === "error" ? current.value.message : ""))}
                </Banner>
              );
            }
            return (
              <div class="grid grid-cols-1 gap-hsp-sm lg:grid-cols-2 lg:items-start">
                <div class="grid grid-cols-1 gap-hsp-sm sm:grid-cols-2" aria-label="Start from">
                  <button
                    type="button"
                    class={computed(() => cardClass(blankSelected.value))}
                    aria-pressed={computed(() => (blankSelected.value ? "true" : "false"))}
                    disabled={formLocked}
                    on:click={() => { selectedSource.value = null; }}
                  >
                    <span class="inline-flex items-center gap-hsp-xs font-semibold text-fg"><FileIcon size="sm" />Blank — no template, whole pack at root</span>
                    <span class="text-muted">Empty root. Add the first component from the canvas.</span>
                  </button>
                  <For each={filteredTemplates} by={(entry) => `${entry.ref.providerId}:${entry.ref.recordId}:${entry.outlet!.id}`}>
                    {(item) => {
                      const entry = item.value;
                      const selected = computed(() => sameSource(selectedSource.value, item.value));
                      return (
                        <button
                          type="button"
                          class={computed(() => cardClass(selected.value))}
                          aria-pressed={computed(() => (selected.value ? "true" : "false"))}
                          disabled={formLocked}
                          on:click={() => { selectedSource.value = item.value; }}
                        >
                          <span class="inline-flex flex-wrap items-center gap-hsp-xs font-semibold text-fg">
                            <ComposerIcon size="sm" />
                            {entry.summary.name}
                            <Chip tone="accent">Global template</Chip>
                            {entry.outletRule?.accepts ? (
                              <Chip tone="warn">{`🔒 ${entry.outletRule.accepts.length} kind${entry.outletRule.accepts.length === 1 ? "" : "s"}`}</Chip>
                            ) : (
                              <Chip>Open</Chip>
                            )}
                          </span>
                          <span class="text-muted">
                            {`Outlet: ${entry.outlet!.label || entry.outlet!.id} · Updated ${formatTimestamp(entry.summary.updatedAt)}`}
                          </span>
                        </button>
                      );
                    }}
                  </For>
                  <Show
                    when={computed(() => templateEntries.value.length === 0)}
                    fallback={() => (
                      <Show when={computed(() => filteredTemplates.value.length === 0)}>
                        {() => (
                          <p class="text-small text-muted">
                            No Global templates match this search.{" "}
                            <Button size="sm" variant="ghost" on:click={() => { query.value = ""; }}>Clear search</Button>
                          </p>
                        )}
                      </Show>
                    )}
                  >
                    {() => <p class="text-small text-muted">No eligible Global templates are available from this provider.</p>}
                  </Show>
                </div>

                <div
                  class="flex flex-col gap-vsp-2xs rounded-md border border-border-strong bg-bg px-hsp-sm py-vsp-xs text-small"
                  aria-label="What you can place"
                >
                  <Rebuild value={selectedSource}>
                    {(source) => (source === null ? (
                      <>
                        <p class="font-semibold text-fg">No template, no rule</p>
                        <p class="text-muted">
                          No template, no rule. The root accepts every component in the pack. Fine for one-offs; agents get no guidance.
                        </p>
                      </>
                    ) : (
                      <>
                        <p class="font-semibold text-fg">{outletSummaryHeading(source, manifest, catalogById)}</p>
                        {source.outletRule?.accepts ? (
                          <>
                            <p class="text-muted">
                              {describeAcceptedKindsLead(source.outletRule, source.outletRule.accepts.length)}
                            </p>
                            <ul class="flex flex-col gap-vsp-3xs">
                              {acceptedKinds(source.outletRule, catalogById, manifest).map((kind) => (
                                <li class="flex flex-wrap items-center gap-hsp-xs">
                                  <span class="text-fg">{kind.title}</span>
                                  {kind.hasOwnRule ? <Chip tone="accent">has rule</Chip> : null}
                                  <span class="text-muted">{kind.id}</span>
                                </li>
                              ))}
                            </ul>
                          </>
                        ) : (
                          <p class="text-muted">No rule: accepts every component in the pack.</p>
                        )}
                        <p class="text-muted">Header/footer come from the template.</p>
                      </>
                    ))}
                  </Rebuild>
                </div>
              </div>
            );
          }}
        </Keyed>
      </div>
    </Dialog>
  );
}
