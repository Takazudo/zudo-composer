/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// The Composer's component chooser dialog (issue #250).
//
// A single, reusable dialog ANY Add affordance can open by supplying #245's
// shared `InsertionTarget` (`{ parentId, slotId, index }`) — the same shape
// canvas insert points (a later wave) and this issue's tree slot Adds both
// use, so "one code path" (epic #243's synthesis note) holds without this
// dialog needing to know who opened it.
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
// Native `<dialog>` + `showModal()` for top-layer rendering; Escape is handled
// explicitly (native UA Escape-to-cancel isn't simulated by every test/DOM
// environment) via a keydown listener that calls `.close()` — the dialog's
// native `close` event then drives `onClose` + focus restoration uniformly for
// every close path (Escape, Cancel, backdrop click, successful add). A
// `aria-live` status region sits OUTSIDE the `<dialog>` (this component is
// expected to be mounted unconditionally, with `open` toggling visibility) so
// "Added" announcements survive the dialog closing/hiding.
//
// ── Live preview + movable tool shell ───────────────────────────────────────
// Search/filter/list rendering stayed in this one component (no internal
// sub-dialog abstraction, per #250's own header note) so this extension could
// wrap the existing target-capture/focus/keyboard machinery without
// re-deriving it. Hovering OR keyboard-focusing a catalog card sets the
// STICKY `previewedComponentId` (never cleared by mouseleave/blur — only
// replaced by the next hover/focus); `ChooserPreviewHost` owns the actual
// second bridge + iframe (see that module's header for the ephemeral
// create/dispose contract). The shared geometry hook makes the shell movable
// for this open session only; it does not touch #250's focus-containment,
// Escape, or target-capture effects.

import { useEffect, useId, useMemo, useRef, useState } from "preact/hooks";
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
} from "../../../../composer";
import type { ComponentDefinition } from "../../active-pack";
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
import { toolDialogStyle, useMovableToolDialog, useToolDialogGeometry } from "../shared/tool-dialog-geometry";

export interface ComposerChooserProps {
  open: boolean;
  /** The target to capture on open. Ignored for the rest of the dialog's lifetime once captured. */
  target: InsertionTarget | null;
  document: CompositionDocument;
  /** The single app-layer `createComponentCatalog(entries)` derivation (issue #290) — never re-derived here. */
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
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // The captured target lives in STATE (not just a ref) so the false -> true
  // capture produces a render — a ref mutation alone wouldn't. Every render
  // below reads ONLY `capturedTarget`, never the live `target` prop, which is
  // what makes a later selection-change prop update unable to redirect an
  // in-flight chooser (see this module's header + the "capture survives a
  // selection change" test).
  const [capturedTarget, setCapturedTarget] = useState<InsertionTarget | null>(null);
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
  const geometry = useToolDialogGeometry({ open });
  const moveGrip = useMovableToolDialog(geometry);

  const titleId = useId();

  const catalogById = useMemo(() => buildCatalogById(entries), [entries]);

  useEffect(() => {
    if (open && capturedTarget === null) {
      setCapturedTarget(target);
      triggerRef.current =
        globalThis.document?.activeElement instanceof HTMLElement ? globalThis.document.activeElement : null;
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
    } else if (!open && capturedTarget !== null) {
      patternRequestGeneration.current += 1;
      setCapturedTarget(null);
    }
  }, [open, target, capturedTarget]);

  // Bridge the controlled `open` prop to the native <dialog> element.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Focus the search input once the CAPTURED content (including the input
  // itself) has actually rendered — a render earlier, on the same tick
  // `showModal()` is called, the content is still gated behind
  // `capturedTarget` being null (see the capture effect above), so
  // `searchRef.current` would not yet exist.
  useEffect(() => {
    if (open && capturedTarget) searchRef.current?.focus();
  }, [open, capturedTarget]);

  // The native `close` event fires for EVERY close path (Escape via our own
  // handler, Cancel, backdrop click, `.close()` after a successful add) — one
  // place to restore focus and tell the controlling parent `open` is false.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    function handleClose() {
      onClose();
      triggerRef.current?.focus?.();
    }
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onClose]);

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
    dialogRef.current?.close();
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
      dialogRef.current?.close();
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

  // Manual Tab-wrap focus containment. Real browsers already make everything
  // OUTSIDE a `showModal()` dialog inert, but not every DOM test environment
  // simulates that (see this module's tests), and defense-in-depth here is
  // cheap and matches common accessible-dialog practice.
  function handleDialogKeyDown(event: JSX.TargetedKeyboardEvent<HTMLDialogElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      dialogRef.current?.close();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>("button, input, [href], [tabindex]")].filter(
      (el) => !el.hasAttribute("disabled"),
    );
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = globalThis.document?.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
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
      <dialog
        ref={dialogRef}
        class="sg-composer-chooser sg-composer-tool-dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={toolDialogStyle(geometry.rect)}
        onKeyDown={handleDialogKeyDown}
        onClick={(event) => {
          if (event.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        {/* Gated on `capturedTarget` (not just `open`) rather than the raw
            `open` prop: this keeps the dialog's interactive content (and its
            accessible names, e.g. duplicate catalog-card titles that also
            appear in the tree) out of the DOM entirely while closed, instead
            of depending on `dialog:not([open]) { display:none }` UA-stylesheet
            behavior a DOM test environment may not simulate. */}
        {capturedTarget && (
          <>
            <div class="sg-composer-chooser-header">
              <button
                type="button"
                class="sg-composer-tool-dialog-grip"
                aria-label="Move dialog"
                aria-describedby={`${titleId}-move-help`}
                aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Home Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight"
                title="Move dialog (Arrow keys; Shift moves farther; Home resets)"
                {...moveGrip}
              >
                <span aria-hidden="true" class="sg-composer-tool-dialog-grip-dots">
                  ⠿
                </span>
              </button>
              <h2 id={titleId} class="sg-composer-chooser-title">
                Add to {targetLabel}
              </h2>
              <button
                type="button"
                class="sg-composer-toolbar-button sg-composer-chooser-cancel"
                onClick={() => dialogRef.current?.close()}
              >
                Cancel
              </button>
              <p class="sg-composer-chooser-target">
                Adding to <strong>{targetLabel}</strong>
              </p>
              <p id={`${titleId}-move-help`} class="sr-only">
                Use Arrow keys to move the dialog 16 pixels, Shift plus Arrow keys to move it 48 pixels, or Home
                to restore its default position and size.
              </p>
            </div>

            <div class="sg-composer-chooser-tabs" role="tablist" aria-label="Add source">
              <button
                id={`${titleId}-components-tab`}
                type="button"
                role="tab"
                class="sg-composer-chooser-tab"
                aria-selected={activeTab === "components"}
                aria-controls={`${titleId}-components-panel`}
                onClick={() => setActiveTab("components")}
              >
                Components
              </button>
              <button
                id={`${titleId}-patterns-tab`}
                type="button"
                role="tab"
                class="sg-composer-chooser-tab"
                aria-selected={activeTab === "patterns"}
                aria-controls={`${titleId}-patterns-panel`}
                onClick={() => setActiveTab("patterns")}
              >
                Patterns
              </button>
            </div>

            <div class="sg-composer-chooser-body">
              {activeTab === "components" ? (
                <div
                  id={`${titleId}-components-panel`}
                  class="sg-composer-chooser-catalog"
                  role="tabpanel"
                  aria-labelledby={`${titleId}-components-tab`}
                >
                  {blockedReason ? (
                    <p class="sg-composer-chooser-empty" role="status">
                      {blockedReason}
                    </p>
                  ) : (
                    <>
                      <div class="sg-composer-chooser-controls">
                        <label class="sg-composer-chooser-search-label">
                          <span class="sr-only">Search components</span>
                          <input
                            ref={searchRef}
                            type="search"
                            class="sg-composer-chooser-search"
                            placeholder="Search components…"
                            value={query}
                            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
                            onKeyDown={handleSearchKeyDown}
                          />
                        </label>

                        <div class="sg-composer-chooser-categories" role="group" aria-label="Filter by category">
                          {categories.map((cat) => (
                            <button
                              key={cat}
                              type="button"
                              class="sg-composer-chooser-category"
                              aria-pressed={category === cat}
                              onClick={() => setCategory(cat)}
                            >
                              {cat}
                            </button>
                          ))}
                        </div>
                      </div>

                      <p class="sg-composer-chooser-count" aria-live="polite">
                        {filtered.length} of {eligible.length} component{eligible.length === 1 ? "" : "s"}
                      </p>

                      {filtered.length === 0 ? (
                        <div class="sg-composer-chooser-empty">
                          <p>No matching components. Try another search or clear the filters.</p>
                          {hasActiveFilter && (
                            <button type="button" class="sg-composer-toolbar-button" onClick={clearFilters}>
                              Clear filters
                            </button>
                          )}
                        </div>
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
                <div
                  id={`${titleId}-patterns-panel`}
                  class="sg-composer-chooser-catalog"
                  role="tabpanel"
                  aria-labelledby={`${titleId}-patterns-tab`}
                >
                  <div class="sg-composer-chooser-controls">
                    <label class="sg-composer-chooser-search-label">
                      <span class="sr-only">Search Patterns</span>
                      <input
                        ref={searchRef}
                        type="search"
                        class="sg-composer-chooser-search"
                        placeholder="Search Patterns…"
                        value={query}
                        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
                        onKeyDown={handleSearchKeyDown}
                      />
                    </label>
                  </div>

                  {patternCatalogLoading ? (
                    <div class="sg-composer-chooser-empty" role="status">
                      <p>Loading Patterns…</p>
                    </div>
                  ) : patternCatalog && patternCatalog.status !== "listed" ? (
                    <div class="sg-composer-chooser-empty" role="status">
                      <p>{patternCatalog.message}</p>
                    </div>
                  ) : !patternCatalog ? (
                    <div class="sg-composer-chooser-empty" role="status">
                      <p>Patterns are unavailable in this editor.</p>
                    </div>
                  ) : filteredPatterns.length === 0 ? (
                    <div class="sg-composer-chooser-empty">
                      <p>{patterns.length === 0 ? "No published Patterns are available." : "No matching Patterns."}</p>
                      {query.trim() && (
                        <button type="button" class="sg-composer-toolbar-button" onClick={clearFilters}>
                          Clear search
                        </button>
                      )}
                    </div>
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
                  entry={previewedEntry}
                  catalogById={catalogById}
                  createBridge={previewCreateBridge}
                  location={previewLocation}
                  hostWindow={previewHostWindow}
                />
              ) : (
                <div class="sg-composer-chooser-pattern-detail">
                  {patternLoading && <p class="sg-composer-chooser-preview-empty">Loading Pattern…</p>}
                  {patternLoadError && <p class="sg-composer-chooser-pattern-error" role="status">{patternLoadError}</p>}
                  {loadedPattern && !patternLoading && !patternLoadError && (
                    <>
                      <ChooserPreviewHost
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
                      {patternInsertError && <p class="sg-composer-chooser-pattern-error" role="status">{patternInsertError}</p>}
                      <button
                        type="button"
                        class="sg-composer-toolbar-button"
                        disabled={!patternEligibility?.eligible || !onInsertPattern || insertingPattern}
                        onClick={() => void confirmPatternInsertion()}
                      >
                        {insertingPattern ? "Inserting…" : "Insert Pattern"}
                      </button>
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
      </dialog>
      <div class="sr-only" role="status" aria-live="polite">
        {status}
      </div>
    </>
  );
}
