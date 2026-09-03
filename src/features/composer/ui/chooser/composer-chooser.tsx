/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// The Composer's component chooser dialog.
//
// A single, reusable dialog any tree or canvas Add affordance can open by
// supplying the shared `InsertionTarget` (`{ parentId, slotId, index }`). The
// chooser therefore has one insertion path and does not need to know its origin.
//
// ── Target capture (the acceptance-critical bit) ────────────────────────────
// Opening the dialog (the `open` prop's false → true transition) CAPTURES
// `target` into its own state (`capturedTarget` — a ref mutation alone
// wouldn't force the render that needs to happen) and the triggering element
// (`document.activeElement`, the Add button just clicked) into a ref. Every
// subsequent render reads ONLY `capturedTarget` — never the live `target`
// prop — so a selection change elsewhere in the app while the dialog is open
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

import { useMemo, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
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
  eligibleEntries,
  matchesQuery,
} from "./chooser-helpers";
import { ChooserPreviewHost } from "./chooser-preview-host";
import { Dialog } from "../../../../components/overlay";
import { Banner, Button, EmptyState, Input, SegmentedControl } from "../../../../components/ui";
import { DuplicateIcon, SearchIcon, XMarkIcon } from "../../../../components/icons";

export interface ComposerChooserProps {
  componentProvider: ComposerComponentProvider;
  open: boolean;
  /** The target to capture on open. Ignored for the rest of the dialog's lifetime once captured. */
  target: InsertionTarget | null;
  document: CompositionDocument;
  /** The single app-layer `createComponentCatalog(entries)` derivation (issue Takazudo/zudo-sg#290) — never re-derived here. */
  manifest: ComponentCatalog;
  /** The richer catalog backing search/filter/display (title/category/description) — same array `manifest` was derived from. */
  entries: readonly ComponentDefinition[];
  /** Fired once, with the CAPTURED target, when a component is chosen. */
  onAdd: (target: InsertionTarget, componentId: string) => void;
  /** Fired right after `onAdd`, with the captured target's ancestor chain, so callers can `setExpanded` each id. */
  onExpandAncestors: (nodeIds: string[]) => void;
  /** Fired on every close path (Escape, Cancel, backdrop, or after a successful add). */
  onClose: () => void;

  // ── Pattern service boundary ───────────────────────────────────────────
  // The app owns the active provider and controller. Keeping those operations
  // injected lets this reusable surface preserve its captured target while an
  // asynchronous source read is in flight, without teaching UI code about
  // stores, routes, or persistence queues.
  /** The active provider's reuse-service catalog outcome. Only Pattern entries are rendered. */
  patternCatalog?: ReuseCatalogOutcome;
  /** The active provider catalog is being read for this open chooser session. */
  patternCatalogLoading?: boolean;
  /** Load the selected Pattern's full saved record on demand. */
  loadPattern?: (ref: CompositionRecordRef) => Promise<ReuseSelectionOutcome>;
  /** Current controller root policy, used for advisory full-forest eligibility. */
  rootPolicy?: RootPolicy;
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
}

export type PatternInsertionOutcome =
  | { status: "inserted" }
  | { status: "rejected"; message: string };

type ChooserTab = "components" | "patterns";

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

export function ComposerChooser({
  componentProvider,
  open,
  target,
  document,
  manifest,
  entries,
  onAdd,
  onExpandAncestors,
  onClose,
  patternCatalog,
  patternCatalogLoading = false,
  loadPattern,
  rootPolicy,
  onInsertPattern,
  previewCreateBridge,
  previewLocation,
  previewHostWindow,
}: ComposerChooserProps): JSX.Element {
  const searchRef = useRef<HTMLInputElement | null>(null);

  // The captured target lives in STATE (not just a ref) so the false -> true
  // capture produces a render — a ref mutation alone wouldn't. Every render
  // below reads ONLY `capturedTarget`, never the live `target` prop, which is
  // what makes a later selection-change prop update unable to redirect an
  // in-flight chooser (see this module's header + the "capture survives a
  // selection change" test).
  const capturedRef = useRef<InsertionTarget | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>(ALL_CATEGORY);
  const [activeTab, setActiveTab] = useState<ChooserTab>("components");
  const [status, setStatus] = useState("");
  // Sticky: set on hover/focus, never cleared by mouseleave/blur — only ever
  // replaced by the NEXT hover/focus, or reset to null on the next open.
  const [previewedComponentId, setPreviewedComponentId] = useState<string | null>(null);
  const [selectedPatternKey, setSelectedPatternKey] = useState<string | null>(null);
  const [loadedPattern, setLoadedPattern] = useState<LoadedPattern | null>(null);
  const [patternLoadError, setPatternLoadError] = useState<string | null>(null);
  const [patternLoading, setPatternLoading] = useState(false);
  const [patternInsertError, setPatternInsertError] = useState<string | null>(null);
  const [insertingPattern, setInsertingPattern] = useState(false);
  const patternRequestGeneration = useRef(0);

  const catalogById = useMemo(() => buildCatalogById(entries), [entries]);

  // Captured DURING RENDER, not in an effect: an effect runs after paint, so
  // the dialog would open one frame before it knew where it was adding, and the
  // shared `Dialog` would have already given initial focus to the close button
  // rather than to a search input that did not exist yet. A ref read back in the
  // same render is enough — no second render is needed to show the capture.
  // Seeded closed rather than from `open`, so a chooser whose first render is
  // already open still captures.
  const wasOpen = useRef(false);
  if (open !== wasOpen.current) {
    wasOpen.current = open;
    capturedRef.current = open ? target : null;
    if (!open) patternRequestGeneration.current += 1;
    setQuery("");
    setCategory(ALL_CATEGORY);
    setActiveTab("components");
    setStatus("");
    setPreviewedComponentId(null);
    setSelectedPatternKey(null);
    setLoadedPattern(null);
    setPatternLoadError(null);
    setPatternLoading(false);
    setPatternInsertError(null);
    setInsertingPattern(false);
  }
  const capturedTarget = capturedRef.current;

  const { entries: eligible, blockedReason } = useMemo(() => {
    if (!capturedTarget) return { entries: [] as ComponentDefinition[], blockedReason: null as string | null };
    return eligibleEntries(document, manifest, entries, capturedTarget);
  }, [capturedTarget, document, manifest, entries]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const entry of eligible) set.add(entry.category);
    return [ALL_CATEGORY, ...[...set].sort()];
  }, [eligible]);

  const filtered = useMemo(() => {
    return eligible.filter(
      (entry) => (category === ALL_CATEGORY || entry.category === category) && matchesQuery(entry, query),
    );
  }, [eligible, category, query]);

  const patterns = useMemo(() => {
    if (!patternCatalog || patternCatalog.status !== "listed") return [];
    return patternCatalog.entries.filter((entry) => entry.kind === "pattern");
  }, [patternCatalog]);

  const filteredPatterns = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return patterns;
    return patterns.filter((entry) => {
      const summary = entry.summary;
      return `${summary.name} ${summary.nodeCount} ${summary.rootCount ?? 0}`.toLocaleLowerCase().includes(needle);
    });
  }, [patterns, query]);

  const targetLabel = capturedTarget ? describeInsertionTarget(document, manifest, catalogById, capturedTarget) : "";

  const previewedEntry = previewedComponentId ? (catalogById.get(previewedComponentId) ?? null) : null;
  const patternEligibility = useMemo(() => {
    if (!capturedTarget || !loadedPattern) return null;
    return assessPatternForestInsertion(document, manifest, capturedTarget, loadedPattern.roots, rootPolicy);
  }, [capturedTarget, document, loadedPattern, manifest, rootPolicy]);

  function confirmAdd(componentId: string) {
    if (!capturedTarget) return;
    const entry = catalogById.get(componentId);
    const ancestors = ancestorChainIds(document, manifest, capturedTarget.parentId);
    onAdd(capturedTarget, componentId);
    onExpandAncestors(ancestors);
    setStatus(`${entry?.title ?? componentId} added to ${targetLabel}.`);
    onClose();
  }

  function selectPattern(ref: CompositionRecordRef, name: string) {
    const key = patternRefKey(ref);
    if (key === selectedPatternKey && (patternLoading || loadedPattern?.key === key)) return;
    setSelectedPatternKey(key);
    setLoadedPattern(null);
    setPatternLoadError(null);
    setPatternInsertError(null);
    const generation = ++patternRequestGeneration.current;

    if (!loadPattern) {
      setPatternLoadError("Patterns are unavailable in this editor.");
      return;
    }

    setPatternLoading(true);
    void loadPattern(ref).then(
      (outcome) => {
        if (generation !== patternRequestGeneration.current) return;
        setPatternLoading(false);
        if (outcome.status !== "loaded" || outcome.kind !== "pattern") {
          setPatternLoadError(
            outcome.status === "loaded"
              ? "This source is no longer published as a Pattern."
              : selectionError(outcome),
          );
          return;
        }
        setLoadedPattern({
          key,
          name,
          roots: outcome.record.document.root,
          document: outcome.record.document,
        });
      },
      (reason) => {
        if (generation !== patternRequestGeneration.current) return;
        setPatternLoading(false);
        setPatternLoadError(reason instanceof Error ? reason.message : "The Pattern could not be loaded.");
      },
    );
  }

  async function confirmPatternInsertion() {
    if (!capturedTarget || !loadedPattern || !patternEligibility?.eligible || !onInsertPattern || insertingPattern) return;
    setPatternInsertError(null);
    setInsertingPattern(true);
    try {
      const outcome = await onInsertPattern(capturedTarget, loadedPattern.roots);
      if (outcome.status !== "inserted") {
        setPatternInsertError(outcome.message);
        return;
      }
      setStatus(`${loadedPattern.name} added to ${targetLabel}.`);
      onClose();
    } catch (reason) {
      setPatternInsertError(reason instanceof Error ? reason.message : "The Pattern could not be inserted.");
    } finally {
      setInsertingPattern(false);
    }
  }

  // Enter only confirms when the current filter narrows to exactly ONE
  // component — with several matches still showing, silently adding
  // whichever happens to sort first would be a surprising, easy-to-mistrigger
  // footgun rather than a helpful shortcut.
  function handleSearchKeyDown(event: JSX.TargetedKeyboardEvent<HTMLInputElement>) {
    if (activeTab === "components" && event.key === "Enter" && filtered.length === 1) {
      event.preventDefault();
      confirmAdd(filtered[0]!.id);
    }
  }

  function clearFilters() {
    setQuery("");
    setCategory(ALL_CATEGORY);
    searchRef.current?.focus();
  }

  const hasActiveFilter = query.trim().length > 0 || category !== ALL_CATEGORY;

  return (
    <>
      <Dialog
        open={open}
        size="wide"
        class="sg-composer-chooser"
        title={capturedTarget ? `Add to ${targetLabel}` : "Add component"}
        initialFocusRef={searchRef}
        onClose={onClose}
        footer={
          <button type="button" class="cms-dialog__action" onClick={onClose}>
            Cancel
          </button>
        }
      >
        {/* Gated on `capturedTarget` rather than on `open` alone: the target is
            captured one render after the dialog opens, and every label below
            names it. */}
        {capturedTarget && (
          <>
            <div class="sg-composer-chooser-source">
              <SegmentedControl<ChooserTab>
                label="Add source"
                size="sm"
                mode="pressed"
                value={activeTab}
                onChange={setActiveTab}
                options={[
                  { value: "components", label: "Components" },
                  { value: "patterns", label: "Patterns" },
                ]}
              />
            </div>

            <div class="sg-composer-chooser-body">
              {activeTab === "components" ? (
                <div class="sg-composer-chooser-catalog" aria-label="Components">
                  {blockedReason ? (
                    <Banner tone="warn">{blockedReason}</Banner>
                  ) : (
                    <>
                      <div class="sg-composer-chooser-controls">
                        <Input
                          elementRef={searchRef}
                          type="search"
                          icon={SearchIcon}
                          class="sg-composer-chooser-search"
                          aria-label="Search components"
                          placeholder="Search components…"
                          value={query}
                          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
                          onKeyDown={handleSearchKeyDown}
                        />

                        <div class="sg-composer-chooser-categories" role="group" aria-label="Filter by category">
                          {categories.map((cat) => (
                            <Button
                              key={cat}
                              size="xs"
                              class="sg-composer-chooser-category"
                              aria-pressed={category === cat}
                              onClick={() => setCategory(cat)}
                            >
                              {cat}
                            </Button>
                          ))}
                        </div>
                      </div>

                      <p class="sg-composer-chooser-count" aria-live="polite">
                        {filtered.length} of {eligible.length} component{eligible.length === 1 ? "" : "s"}
                      </p>

                      {filtered.length === 0 ? (
                        <EmptyState
                          inline
                          title="No matching components"
                          description="Try another search or clear the filters."
                          action={hasActiveFilter && (
                            <Button size="sm" onClick={clearFilters}>
                              <XMarkIcon size="sm" />
                              Clear filters
                            </Button>
                          )}
                        />
                      ) : (
                        <ul class="sg-composer-chooser-list">
                          {filtered.map((entry) => (
                            <li key={entry.id}>
                              <button
                                type="button"
                                class="sg-composer-chooser-card"
                                aria-label={entry.title}
                                aria-describedby={`${entry.id}-meta`}
                                onClick={() => confirmAdd(entry.id)}
                                onMouseEnter={() => setPreviewedComponentId(entry.id)}
                                onFocus={() => setPreviewedComponentId(entry.id)}
                              >
                                <span class="sg-composer-chooser-card-title" aria-hidden="true">
                                  {entry.title}
                                </span>
                                <span id={`${entry.id}-meta`} class="sg-composer-chooser-card-meta">
                                  <span class="sg-composer-chooser-card-category">{entry.category}</span>
                                  <span class="sg-composer-chooser-card-description">{entry.description}</span>
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div class="sg-composer-chooser-catalog" aria-label="Patterns">
                  <div class="sg-composer-chooser-controls">
                    <Input
                      elementRef={searchRef}
                      type="search"
                      icon={SearchIcon}
                      class="sg-composer-chooser-search"
                      aria-label="Search Patterns"
                      placeholder="Search Patterns…"
                      value={query}
                      onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
                      onKeyDown={handleSearchKeyDown}
                    />
                  </div>

                  {patternCatalogLoading ? (
                    <p class="sg-composer-chooser-note" role="status">Loading Patterns…</p>
                  ) : patternCatalog && patternCatalog.status !== "listed" ? (
                    <p class="sg-composer-chooser-note" role="status">{patternCatalog.message}</p>
                  ) : !patternCatalog ? (
                    <p class="sg-composer-chooser-note" role="status">Patterns are unavailable in this editor.</p>
                  ) : filteredPatterns.length === 0 ? (
                    <EmptyState
                      inline
                      title={patterns.length === 0 ? "No published Patterns are available." : "No matching Patterns."}
                      action={query.trim() ? (
                        <Button size="sm" onClick={clearFilters}>
                          <XMarkIcon size="sm" />
                          Clear search
                        </Button>
                      ) : undefined}
                    />
                  ) : (
                    <>
                      <p class="sg-composer-chooser-count" aria-live="polite">
                        {filteredPatterns.length} of {patterns.length} Pattern{patterns.length === 1 ? "" : "s"}
                      </p>
                      <ul class="sg-composer-chooser-list sg-composer-chooser-pattern-list">
                        {filteredPatterns.map((entry) => {
                          const key = patternRefKey(entry.ref);
                          const selected = key === selectedPatternKey;
                          return (
                            <li key={key}>
                              <button
                                type="button"
                                class="sg-composer-chooser-pattern-row"
                                aria-pressed={selected}
                                onClick={() => selectPattern(entry.ref, entry.summary.name)}
                                onMouseEnter={() => selectPattern(entry.ref, entry.summary.name)}
                                onFocus={() => selectPattern(entry.ref, entry.summary.name)}
                              >
                                <span class="sg-composer-chooser-card-title">{entry.summary.name}</span>
                                <span class="sg-composer-chooser-pattern-meta">
                                  {entry.summary.rootCount ?? 0} root{entry.summary.rootCount === 1 ? "" : "s"} · {entry.summary.nodeCount} node{entry.summary.nodeCount === 1 ? "" : "s"}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                </div>
              )}

              {activeTab === "components" ? (
                <ChooserPreviewHost
                  componentProvider={componentProvider}
                  entry={previewedEntry}
                  catalogById={catalogById}
                  createBridge={previewCreateBridge}
                  location={previewLocation}
                  hostWindow={previewHostWindow}
                />
              ) : (
                <div class="sg-composer-chooser-pattern-detail">
                  {patternLoading && <p class="sg-composer-chooser-preview-empty">Loading Pattern…</p>}
                  {patternLoadError && <Banner tone="err">{patternLoadError}</Banner>}
                  {loadedPattern && !patternLoading && !patternLoadError && (
                    <>
                      <ChooserPreviewHost
                        componentProvider={componentProvider}
                        entry={null}
                        sourceDocument={loadedPattern.document}
                        label="Pattern preview"
                        catalogById={catalogById}
                        createBridge={previewCreateBridge}
                        location={previewLocation}
                        hostWindow={previewHostWindow}
                      />
                      {!patternEligibility?.eligible && (
                        <p class="sg-composer-chooser-pattern-error" role="status">
                          {patternEligibility?.reason}
                        </p>
                      )}
                      {patternInsertError && <Banner tone="err">{patternInsertError}</Banner>}
                      <Button
                        variant="primary"
                        disabled={!patternEligibility?.eligible || !onInsertPattern || insertingPattern}
                        onClick={() => void confirmPatternInsertion()}
                      >
                        <DuplicateIcon size="sm" />
                        {insertingPattern ? "Inserting…" : "Insert Pattern"}
                      </Button>
                    </>
                  )}
                  {!patternLoading && !patternLoadError && !loadedPattern && (
                    <p class="sg-composer-chooser-preview-empty">Select a Pattern to preview and insert it.</p>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </Dialog>
      <div class="cms-sr-only" role="status" aria-live="polite">
        {status}
      </div>
    </>
  );
}
