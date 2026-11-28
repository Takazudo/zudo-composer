// The Composer's component chooser dialog.
//
// A single, reusable dialog any tree or canvas Add affordance can open by
// supplying the shared `InsertionTarget` (`{ parentId, slotId, index }`). The
// chooser therefore has one insertion path and does not need to know its origin.
//
// ── Target capture (the acceptance-critical bit) ────────────────────────────
// Opening the dialog (the `open` signal's false → true transition) CAPTURES
// `target` into `captured`, and each opening mounts one fresh chooser
// session that reads ONLY that captured value — never the live `target` —
// so a selection change elsewhere in the app while the dialog is open
// cannot redirect an in-flight "add" to a different destination. See
// `__tests__/composer-chooser.test.tsx`'s "capture survives a selection
// change" test.
//
// ── Accessibility ────────────────────────────────────────────────────────────
// The shared `Dialog` owns the modal: focus trap, initial focus, Escape,
// backdrop dismissal and focus restored to whatever opened it. This surface
// used to reimplement all of that, and it also used to be movable and
// resizable — one dialog size contract is worth more than a shell an author
// has to arrange before using. An `aria-live` status region sits OUTSIDE the
// dialog so "Added" announcements survive it closing.
//
// ── Live preview ────────────────────────────────────────────────────────────
// Search/filter/list rendering stayed in this one component (no internal
// sub-dialog abstraction) so live preview could wrap the existing
// target-capture machinery without re-deriving it. Hovering OR
// keyboard-focusing a catalog card sets the STICKY `previewedComponentId`
// (never cleared by mouseleave/blur — only replaced by the next hover/focus);
// `ChooserPreviewHost` owns the actual second bridge + iframe (see that
// module's header for the ephemeral create/dispose contract).

import { computed, For, getScope, Show, signal, type Child, type ReadonlySignal, type Ref } from "@takazudo/zfb/zudo-react";
import type {
  ComponentCatalog,
  CompositionDocument,
  CompositionNode,
  CompositionRecordRef,
  InsertionTarget,
  ReuseCatalogOutcome,
  ReuseSelectionOutcome,
  RootPolicy,
} from "../../../../composer/browser";
import type { VersionedAssetStore } from "../../../../assets/library";
import type { ComponentDefinition, ComposerComponentProvider } from "../../active-pack";
import type {
  ComposerPreviewLocation,
  MessageTarget,
  createComposerPreviewBridge,
} from "../../preview";
import { ancestorChainIds, buildCatalogById } from "../tree/tree-helpers";
import {
  assessPatternForestInsertion,
  describeInsertionTarget,
  matchesQuery,
} from "./chooser-helpers";
import { describeSlotRule, type SlotRule } from "../slot-rules";
import {
  ChooserHiddenDisclosure,
  ChooserRuleHeader,
  chooserBlockedMessage,
  hiddenComponentNote,
} from "./chooser-rule";
import { LibraryViewToggle } from "../../../../components/library-page/library-toolbar";
import { memo, read, toSignal, type MaybeSignal } from "../../../../components/reactive";
import { Rebuild } from "../../../../components/rebuild";
import { Keyed } from "../../../../runtime";
import { ChooserCardGrid } from "./chooser-card-grid";
import { ChooserPreviewHost } from "./chooser-preview-host";
import { Dialog } from "../../../../components/overlay";
import { Banner, Button, CountBadge, EmptyState, Input, SegmentedControl } from "../../../../components/ui";
import { DuplicateIcon, SearchIcon, XMarkIcon } from "../../../../components/icons";

export interface ComposerChooserProps {
  componentProvider: ComposerComponentProvider;
  open: MaybeSignal<boolean>;
  /** The target to capture on open. Ignored for the rest of the dialog's lifetime once captured. */
  target: MaybeSignal<InsertionTarget | null>;
  document: MaybeSignal<CompositionDocument>;
  /** The single app-layer `createComponentCatalog(entries)` derivation (issue Takazudo/zudo-sg#290) — never re-derived here. */
  manifest: MaybeSignal<ComponentCatalog>;
  /** The richer catalog backing search/filter/display (title/category/description) — same array `manifest` was derived from. */
  entries: MaybeSignal<readonly ComponentDefinition[]>;
  /** Fired once, with the CAPTURED target, when a component is chosen. */
  /** A rejection keeps the chooser/session open when the controller rejects a changed target. */
  onAdd: (target: InsertionTarget, componentId: string) => void | { status: "inserted"; nodeId: string } | { status: "rejected"; message: string };
  /** Fired right after `onAdd`, with the captured target's ancestor chain, so callers can `setExpanded` each id. */
  onExpandAncestors: (nodeIds: string[]) => void;
  /** Fired on every close path (Escape, Cancel, backdrop, or after a successful add). */
  onClose: () => void;
  /** Revalidates a shared-tree pending insertion immediately before mutation. Read at call time. */
  resolveTarget?: () => InsertionTarget | null;
  /** Completes the shared-tree transaction and restores focus after a successful insert. */
  onComplete?: (insertedId?: string) => void;

  // ── Pattern service boundary ───────────────────────────────────────────
  // The app owns the active provider and controller. Keeping those operations
  // injected lets this reusable surface preserve its captured target while an
  // asynchronous source read is in flight, without teaching UI code about
  // stores, routes, or persistence queues.
  /** The active provider's reuse-service catalog outcome. Only Pattern entries are rendered. */
  patternCatalog?: MaybeSignal<ReuseCatalogOutcome | undefined>;
  /** The active provider catalog is being read for this open chooser session. */
  patternCatalogLoading?: MaybeSignal<boolean>;
  /** Load the selected Pattern's full saved record on demand. */
  loadPattern?: (ref: CompositionRecordRef) => Promise<ReuseSelectionOutcome>;
  /** Current controller root policy, used for advisory full-forest eligibility. */
  rootPolicy?: MaybeSignal<RootPolicy | undefined>;
  /** Tab shown when the chooser opens; the canvas quick insert's "Pattern…" chip asks for Patterns. */
  initialTab?: MaybeSignal<ChooserTab>;
  /**
   * Revalidate and invoke the controller's one atomic forest command. The
   * dialog closes only for `inserted`; a rejection keeps the selected Pattern,
   * filter, captured target, and focus in place for a retry or cancellation.
   */
  onInsertPattern?: (
    target: InsertionTarget,
    sourceRoots: readonly CompositionNode[],
  ) => PatternInsertionOutcome | Promise<PatternInsertionOutcome>;

  // ── Live preview pane test seams (production defaults) — forwarded to
  // `ChooserPreviewHost`'s OWN, second bridge. Never used by the main canvas. ──
  previewCreateBridge?: typeof createComposerPreviewBridge;
  previewLocation?: ComposerPreviewLocation;
  previewHostWindow?: MessageTarget;
  /** The workspace's versioned Asset store, for the preview panes. */
  assetStore?: VersionedAssetStore;
}

export type PatternInsertionOutcome =
  | { status: "inserted"; nodeId?: string }
  | { status: "rejected"; message: string };

export type ChooserTab = "components" | "patterns";

interface LoadedPattern {
  key: string;
  name: string;
  roots: readonly CompositionNode[];
  document: CompositionDocument;
}

function patternRefKey(ref: CompositionRecordRef): string {
  return `${ref.providerId}:${ref.recordId}`;
}

function selectionError(outcome: Exclude<ReuseSelectionOutcome, { status: "loaded" }>): string {
  switch (outcome.status) {
    case "empty":
      return "This Pattern no longer contains any components.";
    case "invalid":
      switch (outcome.reason) {
        case "current-record":
          return "The current Composition cannot be inserted as its own Pattern.";
        case "nested-template":
          return "A bound Composition cannot be used as a Pattern.";
        case "missing-outlet":
          return "This source is no longer a valid reusable Pattern.";
        default:
          return "This source is no longer published as a Pattern.";
      }
    case "unavailable":
    case "load-error":
      return outcome.message;
  }
}

const ALL_CATEGORY = "All" as const;
const VIEW_STORAGE_KEY = "zudo-composer.chooser.view";
type ChooserView = "list" | "cards";
function readView(): ChooserView {
  try { return globalThis.localStorage?.getItem(VIEW_STORAGE_KEY) === "list" ? "list" : "cards"; }
  catch { return "cards"; }
}

interface ChooserSessionProps extends Omit<ComposerChooserProps, "open" | "target" | "document" | "manifest" | "entries" | "patternCatalog" | "patternCatalogLoading" | "rootPolicy" | "initialTab"> {
  target: InsertionTarget;
  document: ReadonlySignal<CompositionDocument>;
  manifest: ReadonlySignal<ComponentCatalog>;
  entries: ReadonlySignal<readonly ComponentDefinition[]>;
  catalogById: ReadonlySignal<ReadonlyMap<string, ComponentDefinition>>;
  patternCatalog: ReadonlySignal<ReuseCatalogOutcome | undefined>;
  patternCatalogLoading: ReadonlySignal<boolean>;
  rootPolicy: ReadonlySignal<RootPolicy | undefined>;
  restrictedRule: ReadonlySignal<SlotRule | null>;
  targetLabel: ReadonlySignal<string>;
  initialTab: ChooserTab;
  searchRef: Ref<HTMLInputElement>;
  viewMode: ReadonlySignal<ChooserView>;
  changeView: (view: ChooserView) => void;
  setStatus: (status: string) => void;
}

export function ComposerChooser({
  open: openProp,
  target: targetProp,
  document: documentProp,
  manifest: manifestProp,
  entries: entriesProp,
  patternCatalog: patternCatalogProp,
  patternCatalogLoading: patternCatalogLoadingProp = false,
  rootPolicy: rootPolicyProp,
  initialTab: initialTabProp = "components",
  onClose,
  ...rest
}: ComposerChooserProps): Child {
  const scope = getScope();
  const searchRef: Ref<HTMLInputElement> = { current: null };
  const viewMode = signal<ChooserView>(readView());
  function changeView(view: ChooserView) {
    viewMode.value = view;
    try { globalThis.localStorage?.setItem(VIEW_STORAGE_KEY, view); } catch { /* Storage is optional. */ }
  }
  const status = signal("");
  const open = computed(() => read(openProp));
  const target = toSignal(targetProp);
  const document = toSignal(documentProp);
  const manifest = toSignal(manifestProp);
  const entries = toSignal(entriesProp);
  const patternCatalog = toSignal(patternCatalogProp);
  const patternCatalogLoading = computed(() => read(patternCatalogLoadingProp));
  const rootPolicy = toSignal(rootPolicyProp);
  const catalogById = computed(() => buildCatalogById(entries.value));

  // Captured on the false → true transition of `open` and held until it
  // closes; seeded closed so a chooser that mounts already open still captures.
  let wasOpen = false;
  let capturedValue: InsertionTarget | null = null;
  const captured = computed(() => {
    const isOpen = open.value;
    const liveTarget = target.value;
    if (isOpen !== wasOpen) {
      wasOpen = isOpen;
      capturedValue = isOpen ? liveTarget : null;
    }
    return capturedValue;
  });
  let statusOpen = false;
  scope.effect(() => {
    const isOpen = open.value;
    if (isOpen === statusOpen) return;
    statusOpen = isOpen;
    if (isOpen) status.value = "";
  });

  const rule = computed(() => {
    const capturedTarget = captured.value;
    return capturedTarget
      ? describeSlotRule({ catalog: entries.value, manifest: manifest.value, document: document.value, target: capturedTarget, rootPolicy: rootPolicy.value })
      : null;
  });
  // Rule presentation is only for a restricted target; an open one renders exactly as before.
  const restrictedRule = computed(() => (rule.value?.kind === "restricted" ? rule.value : null));
  const targetLabel = computed(() => {
    const capturedTarget = captured.value;
    return capturedTarget
      ? describeInsertionTarget(document.value, manifest.value, catalogById.value, capturedTarget, rootPolicy.value)
      : "";
  });
  const title = computed(() => (captured.value ? `Add to ${targetLabel.value}` : "Add component"));
  const viaTemplate = computed(() => restrictedRule.value?.origin?.viaTemplate?.sourceName ?? null);

  return (
    <>
      <Dialog
        open={open}
        size="full"
        class="sg-composer-chooser"
        title={title}
        initialFocusRef={searchRef}
        onClose={onClose}
        footer={
          <>
            <Show when={computed(() => viaTemplate.value !== null)}>
              {() => (
                <p class="sg-composer-chooser-footer-note">
                  {computed(() => `Rule applies because this page is bound to the ${viaTemplate.value ?? ""} template.`)}
                </p>
              )}
            </Show>
            <button type="button" class="cms-dialog__action" on:click={() => onClose()}>
              Cancel
            </button>
          </>
        }
      >
        {/* Gated on the captured target, which every label below names. One
            opening mounts one session, so its state starts fresh each time. */}
        <Keyed value={captured} by={(capturedTarget) => (capturedTarget ? "captured" : "none")}>
          {(capturedSignal) => {
            const capturedTarget = capturedSignal.value;
            if (!capturedTarget) return null;
            return (
              <ChooserSession
                {...rest}
                onClose={onClose}
                target={capturedTarget}
                document={document}
                manifest={manifest}
                entries={entries}
                catalogById={catalogById}
                patternCatalog={patternCatalog}
                patternCatalogLoading={patternCatalogLoading}
                rootPolicy={rootPolicy}
                restrictedRule={restrictedRule}
                targetLabel={targetLabel}
                initialTab={read(initialTabProp)}
                searchRef={searchRef}
                viewMode={viewMode}
                changeView={changeView}
                setStatus={(next) => {
                  status.value = next;
                }}
              />
            );
          }}
        </Keyed>
      </Dialog>
      <div class="cms-sr-only" role="status" aria-live="polite">
        {status}
      </div>
    </>
  );
}

function ChooserSession({
  componentProvider,
  target: capturedTarget,
  document,
  manifest,
  entries,
  catalogById,
  onAdd,
  onExpandAncestors,
  onClose,
  resolveTarget,
  onComplete,
  patternCatalog,
  patternCatalogLoading,
  loadPattern,
  rootPolicy,
  restrictedRule,
  targetLabel,
  initialTab,
  onInsertPattern,
  previewCreateBridge,
  previewLocation,
  previewHostWindow,
  assetStore,
  searchRef,
  viewMode,
  changeView,
  setStatus,
}: ChooserSessionProps): Child {
  const scope = getScope();
  const catalogRef: Ref<HTMLDivElement> = { current: null };
  const query = signal("");
  const category = signal<string>(ALL_CATEGORY);
  const activeTab = signal<ChooserTab>(initialTab);
  // Sticky: set on hover/focus, never cleared by mouseleave/blur — only ever
  // replaced by the NEXT hover/focus; each opening starts a fresh session.
  const previewedComponentId = signal<string | null>(null);
  const selectedPatternKey = signal<string | null>(null);
  const loadedPattern = signal<LoadedPattern | null>(null);
  const patternLoadError = signal<string | null>(null);
  const patternLoading = signal(false);
  const patternInsertError = signal<string | null>(null);
  const insertingPattern = signal(false);
  const hiddenOpen = signal(false);
  let fallThroughQuery: string | null = null;
  let patternRequestGeneration = 0;
  scope.onCleanup(() => {
    patternRequestGeneration += 1;
    searchRef.current = null;
  });

  const rule = computed(() =>
    describeSlotRule({ catalog: entries.value, manifest: manifest.value, document: document.value, target: capturedTarget, rootPolicy: rootPolicy.value }),
  );
  const blockedReason = computed(() => chooserBlockedMessage(rule.value));
  const eligible = computed(() => {
    const current = rule.value;
    if (current.blockedReason !== null) return [];
    const accepted = new Set(current.accepts.map((component) => component.id));
    return entries.value.filter((entry) => accepted.has(entry.id));
  });
  const ownRuleIds = computed(() => {
    const restricted = restrictedRule.value;
    return restricted ? new Set(restricted.accepts.filter((component) => component.hasOwnRule).map((component) => component.id)) : undefined;
  });
  // The rule's own container is never offered inside itself, so it is not listed as hidden either.
  const hiddenByRule = computed(() => {
    const restricted = restrictedRule.value;
    return restricted?.hiddenByRule.filter((component) => component.id !== restricted.origin?.componentId) ?? [];
  });

  const categories = computed(() => {
    const set = new Set<string>();
    for (const entry of eligible.value) set.add(entry.category);
    return [ALL_CATEGORY, ...[...set].sort()];
  });

  const filtered = computed(() =>
    eligible.value.filter(
      (entry) => (category.value === ALL_CATEGORY || entry.category === category.value) && matchesQuery(entry, query.value),
    ),
  );

  const filteredHidden = computed(() =>
    hiddenByRule.value.filter((component) => {
      if (category.value !== ALL_CATEGORY && component.category !== category.value) return false;
      const definition = catalogById.value.get(component.id);
      return definition ? matchesQuery(definition, query.value) : true;
    }),
  );

  // Search falls through to hidden rows: a query that matches nothing allowed
  // but something hidden opens the disclosure once, instead of an empty state.
  const fallThrough = computed(() => query.value.trim().length > 0 && filtered.value.length === 0 && filteredHidden.value.length > 0);
  scope.effect(() => {
    const falling = fallThrough.value;
    const currentQuery = query.value;
    if (!falling) {
      fallThroughQuery = null;
      return;
    }
    if (fallThroughQuery === currentQuery) return;
    fallThroughQuery = currentQuery;
    if (!hiddenOpen.value) hiddenOpen.value = true;
  });

  const patterns = computed(() => {
    const catalog = patternCatalog.value;
    if (!catalog || catalog.status !== "listed") return [];
    return catalog.entries.filter((entry) => entry.kind === "pattern");
  });

  const filteredPatterns = computed(() => {
    const needle = query.value.trim().toLocaleLowerCase();
    if (!needle) return patterns.value;
    return patterns.value.filter((entry) => {
      const summary = entry.summary;
      return `${summary.name} ${summary.nodeCount} ${summary.rootCount ?? 0}`.toLocaleLowerCase().includes(needle);
    });
  });

  const previewedEntry = computed(() => {
    const id = previewedComponentId.value;
    return id ? (catalogById.value.get(id) ?? null) : null;
  });
  const previewedHidden = computed(() => {
    const id = previewedComponentId.value;
    return restrictedRule.value && id ? (hiddenByRule.value.find((component) => component.id === id) ?? null) : null;
  });
  const patternEligibility = computed(() => {
    const loaded = loadedPattern.value;
    if (!loaded) return null;
    return assessPatternForestInsertion(document.value, manifest.value, capturedTarget, loaded.roots, rootPolicy.value);
  });

  function confirmAdd(componentId: string) {
    const currentTarget = resolveTarget ? resolveTarget() : capturedTarget;
    if (!currentTarget) {
      setStatus("That insertion point is no longer available. Cancel and choose another location.");
      return;
    }
    const entry = catalogById.value.get(componentId);
    const ancestors = ancestorChainIds(document.value, manifest.value, currentTarget.parentId);
    const label = targetLabel.value;
    const applied = onAdd(currentTarget, componentId);
    if (applied && applied.status === "rejected") {
      setStatus(applied.message);
      return;
    }
    onExpandAncestors(ancestors);
    setStatus(`${entry?.title ?? componentId} added to ${label}.`);
    if (onComplete) onComplete(applied && applied.status === "inserted" ? applied.nodeId : undefined);
    else onClose();
  }

  function selectPattern(ref: CompositionRecordRef, name: string) {
    const key = patternRefKey(ref);
    if (key === selectedPatternKey.value && (patternLoading.value || loadedPattern.value?.key === key)) return;
    selectedPatternKey.value = key;
    loadedPattern.value = null;
    patternLoadError.value = null;
    patternInsertError.value = null;
    const generation = ++patternRequestGeneration;

    if (!loadPattern) {
      patternLoadError.value = "Patterns are unavailable in this editor.";
      return;
    }

    patternLoading.value = true;
    void loadPattern(ref).then(
      (outcome) => {
        if (generation !== patternRequestGeneration || scope.abortSignal.aborted) return;
        patternLoading.value = false;
        if (outcome.status !== "loaded" || outcome.kind !== "pattern") {
          patternLoadError.value = outcome.status === "loaded"
            ? "This source is no longer published as a Pattern."
            : selectionError(outcome);
          return;
        }
        loadedPattern.value = {
          key,
          name,
          roots: outcome.record.document.root,
          document: outcome.record.document,
        };
      },
      (reason) => {
        if (generation !== patternRequestGeneration || scope.abortSignal.aborted) return;
        patternLoading.value = false;
        patternLoadError.value = reason instanceof Error ? reason.message : "The Pattern could not be loaded.";
      },
    );
  }

  async function confirmPatternInsertion() {
    const loaded = loadedPattern.value;
    if (!loaded || !patternEligibility.value?.eligible || !onInsertPattern || insertingPattern.value) return;
    const currentTarget = resolveTarget ? resolveTarget() : capturedTarget;
    if (!currentTarget) {
      patternInsertError.value = "That insertion point is no longer available. Cancel and choose another location.";
      return;
    }
    const label = targetLabel.value;
    patternInsertError.value = null;
    insertingPattern.value = true;
    try {
      const outcome = await onInsertPattern(currentTarget, loaded.roots);
      if (scope.abortSignal.aborted) return;
      if (outcome.status !== "inserted") {
        patternInsertError.value = outcome.message;
        return;
      }
      setStatus(`${loaded.name} added to ${label}.`);
      if (onComplete) onComplete(outcome.nodeId);
      else onClose();
    } catch (reason) {
      if (scope.abortSignal.aborted) return;
      patternInsertError.value = reason instanceof Error ? reason.message : "The Pattern could not be inserted.";
    } finally {
      if (!scope.abortSignal.aborted) insertingPattern.value = false;
    }
  }

  // Enter only confirms when the current filter narrows to exactly ONE
  // component — with several matches still showing, silently adding
  // whichever happens to sort first would be a surprising, easy-to-mistrigger
  // footgun rather than a helpful shortcut.
  function handleSearchKeyDown(event: KeyboardEvent) {
    if (activeTab.value === "components" && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      const results = catalogRef.current?.querySelectorAll<HTMLButtonElement>("[data-chooser-result]");
      const result = event.key === "ArrowDown" ? results?.[0] : results?.[results.length - 1];
      if (result) { event.preventDefault(); result.focus(); }
    }
    if (activeTab.value === "components" && event.key === "Enter" && filtered.value.length === 1) {
      event.preventDefault();
      confirmAdd(filtered.value[0]!.id);
    }
  }

  function clearFilters() {
    query.value = "";
    category.value = ALL_CATEGORY;
    searchRef.current?.focus();
  }

  const hasActiveFilter = computed(() => query.value.trim().length > 0 || category.value !== ALL_CATEGORY);
  const onSearchInput = (event: Event) => {
    query.value = (event.target as HTMLInputElement).value;
  };

  type ComponentResults = "fall-through" | "empty-filtered" | "empty" | "cards" | "list";
  const componentResults = computed((): ComponentResults => {
    if (filtered.value.length === 0) {
      if (fallThrough.value) return "fall-through";
      return hasActiveFilter.value ? "empty-filtered" : "empty";
    }
    return viewMode.value === "cards" ? "cards" : "list";
  });

  const componentsCatalog = () => (
    <div ref={catalogRef} class="sg-composer-chooser-catalog" aria-label="Components">
      <Show
        when={computed(() => blockedReason.value === null)}
        fallback={() => <Banner tone="warn">{computed(() => blockedReason.value ?? "")}</Banner>}
      >
        {() => (
          <>
            <div class="sg-composer-chooser-controls">
              <div class="sg-composer-chooser-toolbar">
                <Input
                  elementRef={searchRef}
                  type="search"
                  icon={SearchIcon}
                  class="sg-composer-chooser-search"
                  aria-label="Search components"
                  placeholder="Search components…"
                  modelValue={query}
                  on:input={onSearchInput}
                  on:keydown={handleSearchKeyDown}
                />
                <div class="sg-composer-chooser-view-toggle">
                  <LibraryViewToggle value={computed(() => (viewMode.value === "list" ? "table" : "cards"))}
                    onChange={(view) => changeView(view === "table" ? "list" : "cards")}
                    label="Component view" tableLabel="List" />
                </div>
              </div>

              <div class="sg-composer-chooser-categories" role="group" aria-label="Filter by category">
                <For each={categories} by={(cat) => cat}>
                  {(cat) => (
                    <Button
                      size="xs"
                      class="sg-composer-chooser-category"
                      aria-pressed={computed(() => (category.value === cat.value ? "true" : "false"))}
                      on:click={() => {
                        category.value = cat.value;
                      }}
                    >
                      {cat.value}
                    </Button>
                  )}
                </For>
              </div>
            </div>

            <Show when={computed(() => restrictedRule.value !== null)}>
              {() => (
                <p class="sg-composer-chooser-section">
                  Allowed here
                  <CountBadge count={computed(() => eligible.value.length)} class="sg-composer-chooser-section-count" />
                </p>
              )}
            </Show>
            <p class="sg-composer-chooser-count" aria-live="polite">
              {computed(() => `${filtered.value.length} of ${eligible.value.length} component${eligible.value.length === 1 ? "" : "s"}`)}
            </p>

            <Keyed value={componentResults} by={(mode) => mode}>
              {(mode) => {
                switch (mode.value) {
                  case "fall-through":
                    return null;
                  case "empty":
                  case "empty-filtered":
                    return (
                      <EmptyState
                        inline
                        title="No matching components"
                        description="Try another search or clear the filters."
                        action={mode.value === "empty-filtered" ? (
                          <Button size="sm" on:click={clearFilters}>
                            <XMarkIcon size="sm" />
                            Clear filters
                          </Button>
                        ) : undefined}
                      />
                    );
                  case "cards":
                    return (
                      <ChooserCardGrid entries={filtered} componentProvider={componentProvider} catalogById={catalogById.value}
                        ownRuleIds={ownRuleIds} onPreview={(id) => { previewedComponentId.value = id; }} onConfirm={confirmAdd}
                        location={previewLocation} assetStore={assetStore} />
                    );
                  case "list":
                    return (
                      <ul class="sg-composer-chooser-list">
                        <For each={filtered} by={(entry) => entry.id}>
                          {(entrySignal) => {
                            const entry = entrySignal.value;
                            return (
                              <li>
                                <button
                                  type="button"
                                  class="sg-composer-chooser-card"
                                  data-chooser-result
                                  aria-label={entry.title}
                                  aria-describedby={`${entry.id}-meta`}
                                  on:click={() => confirmAdd(entry.id)}
                                  on:mouseenter={() => { previewedComponentId.value = entry.id; }}
                                  on:focus={() => { previewedComponentId.value = entry.id; }}
                                >
                                  <span class="sg-composer-chooser-card-title" aria-hidden="true">
                                    {entry.title}
                                    <Show when={computed(() => ownRuleIds.value?.has(entry.id) ?? false)}>
                                      {() => <span class="sg-composer-chooser-rule-badge">rule</span>}
                                    </Show>
                                  </span>
                                  <span id={`${entry.id}-meta`} class="sg-composer-chooser-card-meta">
                                    <span class="sg-composer-chooser-card-category">{entry.category}</span>
                                    <span class="sg-composer-chooser-card-description">{entry.description}</span>
                                  </span>
                                </button>
                              </li>
                            );
                          }}
                        </For>
                      </ul>
                    );
                }
              }}
            </Keyed>

            <Rebuild value={memo(() => ({ rule: restrictedRule.value, components: filteredHidden.value }))}>
              {({ rule: restricted, components }) => restricted && components.length > 0 ? (
                <ChooserHiddenDisclosure
                  rule={restricted}
                  components={components}
                  open={hiddenOpen}
                  onToggle={(next) => { hiddenOpen.value = next; }}
                  previewedId={previewedComponentId}
                  onPreview={(id) => { previewedComponentId.value = id; }}
                />
              ) : null}
            </Rebuild>
          </>
        )}
      </Show>
    </div>
  );

  type PatternListState = "loading" | "failed" | "unavailable" | "empty-none" | "empty-search" | "empty" | "list";
  const patternListState = computed((): PatternListState => {
    if (patternCatalogLoading.value) return "loading";
    const catalog = patternCatalog.value;
    if (catalog && catalog.status !== "listed") return "failed";
    if (!catalog) return "unavailable";
    if (filteredPatterns.value.length === 0) {
      if (patterns.value.length === 0) return query.value.trim() ? "empty-none" : "empty";
      return query.value.trim() ? "empty-search" : "empty";
    }
    return "list";
  });

  const patternsCatalog = () => (
    <div class="sg-composer-chooser-catalog" aria-label="Patterns">
      <div class="sg-composer-chooser-controls">
        <div class="sg-composer-chooser-toolbar">
          <Input
            elementRef={searchRef}
            type="search"
            icon={SearchIcon}
            class="sg-composer-chooser-search"
            aria-label="Search Patterns"
            placeholder="Search Patterns…"
            modelValue={query}
            on:input={onSearchInput}
            on:keydown={handleSearchKeyDown}
          />
        </div>
      </div>

      <Keyed value={patternListState} by={(state) => state}>
        {(state) => {
          switch (state.value) {
            case "loading":
              return <p class="sg-composer-chooser-note" role="status">Loading Patterns…</p>;
            case "failed":
              return (
                <p class="sg-composer-chooser-note" role="status">
                  {computed(() => {
                    const catalog = patternCatalog.value;
                    return catalog && catalog.status !== "listed" ? catalog.message : "";
                  })}
                </p>
              );
            case "unavailable":
              return <p class="sg-composer-chooser-note" role="status">Patterns are unavailable in this editor.</p>;
            case "empty":
            case "empty-none":
            case "empty-search":
              return (
                <EmptyState
                  inline
                  title={patterns.value.length === 0 ? "No published Patterns are available." : "No matching Patterns."}
                  action={state.value === "empty" ? undefined : (
                    <Button size="sm" on:click={clearFilters}>
                      <XMarkIcon size="sm" />
                      Clear search
                    </Button>
                  )}
                />
              );
            case "list":
              return (
                <>
                  <p class="sg-composer-chooser-count" aria-live="polite">
                    {computed(() => `${filteredPatterns.value.length} of ${patterns.value.length} Pattern${patterns.value.length === 1 ? "" : "s"}`)}
                  </p>
                  <ul class="sg-composer-chooser-list">
                    <For each={filteredPatterns} by={(entry) => patternRefKey(entry.ref)}>
                      {(entrySignal) => {
                        const key = patternRefKey(entrySignal.value.ref);
                        const choose = () => selectPattern(entrySignal.value.ref, entrySignal.value.summary.name);
                        return (
                          <li>
                            <button
                              type="button"
                              class="sg-composer-chooser-pattern-row"
                              aria-pressed={computed(() => (key === selectedPatternKey.value ? "true" : "false"))}
                              on:click={choose}
                              on:mouseenter={choose}
                              on:focus={choose}
                            >
                              <span class="sg-composer-chooser-card-title">{computed(() => entrySignal.value.summary.name)}</span>
                              <span class="sg-composer-chooser-pattern-meta">
                                {computed(() => {
                                  const summary = entrySignal.value.summary;
                                  return `${summary.rootCount ?? 0} root${summary.rootCount === 1 ? "" : "s"} · ${summary.nodeCount} node${summary.nodeCount === 1 ? "" : "s"}`;
                                })}
                              </span>
                            </button>
                          </li>
                        );
                      }}
                    </For>
                  </ul>
                </>
              );
          }
        }}
      </Keyed>
    </div>
  );

  const notice = computed((): Child => {
    const restricted = restrictedRule.value;
    const hidden = previewedHidden.value;
    if (!restricted || !hidden) return null;
    return (
      <div class="sg-composer-chooser-hidden-notice">
        <Banner tone="warn">{hiddenComponentNote(restricted, targetLabel.value, hidden)}</Banner>
        <Button variant="primary" disabled>Insert</Button>
      </div>
    );
  });

  const showLoadedPattern = computed(() => loadedPattern.value !== null && !patternLoading.value && patternLoadError.value === null);
  const patternDetail = () => (
    <div class="sg-composer-chooser-pattern-detail">
      <Show when={patternLoading}>{() => <p class="sg-composer-chooser-preview-empty">Loading Pattern…</p>}</Show>
      <Show when={computed(() => patternLoadError.value !== null)}>
        {() => <Banner tone="err">{computed(() => patternLoadError.value ?? "")}</Banner>}
      </Show>
      <Show when={showLoadedPattern}>
        {() => (
          <>
            <ChooserPreviewHost
              componentProvider={componentProvider}
              entry={null}
              sourceDocument={computed(() => loadedPattern.value?.document ?? null)}
              label="Pattern preview"
              catalogById={catalogById.value}
              createBridge={previewCreateBridge}
              location={previewLocation}
              hostWindow={previewHostWindow}
              assetStore={assetStore}
            />
            <Show when={computed(() => !patternEligibility.value?.eligible)}>
              {() => (
                <p class="sg-composer-chooser-pattern-error" role="status">
                  {computed(() => patternEligibility.value?.reason ?? "")}
                </p>
              )}
            </Show>
            <Show when={computed(() => patternInsertError.value !== null)}>
              {() => <Banner tone="err">{computed(() => patternInsertError.value ?? "")}</Banner>}
            </Show>
            <Button
              variant="primary"
              disabled={computed(() => !patternEligibility.value?.eligible || !onInsertPattern || insertingPattern.value)}
              on:click={() => void confirmPatternInsertion()}
            >
              <DuplicateIcon size="sm" />
              {computed(() => (insertingPattern.value ? "Inserting…" : "Insert Pattern"))}
            </Button>
          </>
        )}
      </Show>
      <Show when={computed(() => !patternLoading.value && patternLoadError.value === null && loadedPattern.value === null)}>
        {() => <p class="sg-composer-chooser-preview-empty">Select a Pattern to preview and insert it.</p>}
      </Show>
    </div>
  );

  const componentsTab = computed(() => activeTab.value === "components");
  return (
    <>
      <Rebuild value={restrictedRule}>
        {(restricted) => (restricted ? <ChooserRuleHeader rule={restricted} /> : null)}
      </Rebuild>
      <div class="sg-composer-chooser-source">
        <SegmentedControl<ChooserTab>
          label="Add source"
          size="sm"
          mode="pressed"
          value={activeTab}
          onChange={(tab) => {
            activeTab.value = tab;
          }}
          options={[
            { value: "components", label: "Components" },
            { value: "patterns", label: "Patterns" },
          ]}
        />
      </div>

      <div class="sg-composer-chooser-body">
        <Show when={componentsTab} fallback={patternsCatalog}>
          {componentsCatalog}
        </Show>
        <Show when={componentsTab} fallback={patternDetail}>
          {() => (
            <ChooserPreviewHost
              componentProvider={componentProvider}
              entry={previewedEntry}
              catalogById={catalogById.value}
              createBridge={previewCreateBridge}
              location={previewLocation}
              hostWindow={previewHostWindow}
              assetStore={assetStore}
              notice={notice}
            />
          )}
        </Show>
      </div>
    </>
  );
}
