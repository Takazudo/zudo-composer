// Pure Composer controller state + reducer (issue Takazudo/zudo-sg#247).
//
// The parent `/composer` route owns two independent pieces of state:
//   - the Takazudo/zudo-sg#245 `CompositionDocument` (the persisted, versioned document tree)
//   - session state that never round-trips through the document itself:
//     selection, expansion, edit/preview mode, canvas viewport choice, rail
//     widths, and an honest save/load status.
//
// This module is 100% pure — no DOM, no localStorage, no Preact. It only
// applies Takazudo/zudo-sg#245's commands (addNode/updateProps/reorderNode/removeNode) and
// folds their `CommandResult` into a new `ComposerControllerState`. Side
// effects (queue persistence, resizer DOM wiring, and the native navigation
// guard) live in sibling modules. Keeping this reducer pure makes its command
// and callback behavior cheap to prove without a DOM harness.

import type {
  CommandResult,
  ComponentCatalog,
  CompositionDocument,
  CompositionDerivedOutputOutcome,
  CompositionNode,
  GlobalTemplateOutletTarget,
  IdFactory,
  InsertionTarget,
  JsonObject,
  PublicationDependencyGuard,
  ResolvedGlobalTemplateOutletContract,
  RootPolicy,
} from "../../../composer/browser";
import {
  addNode,
  bindConsumer,
  clearPublication,
  cloneJson,
  cloneSubtreeWithNewIds,
  effectiveRootPolicy,
  findLocation,
  insertForest,
  insertSubtree,
  isNodeOpaque,
  moveSubtree,
  publishGlobalTemplate,
  publishPattern,
  reassignGlobalTemplateOutlet,
  removeBinding,
  removeNode,
  reorderNode,
  repairSelection,
  renameGlobalTemplateOutlet,
  setGlobalTemplateOutlet,
  updateProps,
} from "../../../composer/browser";

/** Edit vs. read-only preview rendering of the canvas. */
export type ComposerMode = "edit" | "preview";

/**
 * Canvas viewport choice. Session state only — the preview iframe (Takazudo/zudo-sg#248) owns
 * actually scaling/framing its document to match.
 */
export type ComposerCanvasViewport = "fluid" | "desktop" | "tablet" | "mobile";

/**
 * Honest persistence status. Only `"saved"` means the mounted record matches
 * the provider. `dirty` and `saving` mirror the async record queue.
 *
 *  - `"saved"` — the last mutation persisted successfully.
 *  - `"dirty"` — a mutation is waiting for the record save queue.
 *  - `"saving"` — the queue is persisting the newest snapshot.
 *  - `"error"` — the provider rejected the latest save.
 */
export type ComposerSaveStatus =
  | { kind: "saved" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "error"; reason: string };

export interface ComposerControllerState {
  document: CompositionDocument;
  selectedId: string | null;
  expandedIds: ReadonlySet<string>;
  mode: ComposerMode;
  viewport: ComposerCanvasViewport;
  leftWidth: number;
  rightWidth: number;
  saveStatus: ComposerSaveStatus;
  /**
   * File-provider generated output is derived, never canonical document data.
   * A blocked outcome therefore sits beside Saved rather than replacing it.
   */
  derivedOutput: CompositionDerivedOutputOutcome | null;
  /**
   * Session-only clipboard: a deep-cloned JSON subtree payload, NEVER a live
   * node reference — it is a snapshot that survives later edits to the
   * document (including edits to the very node it was copied from). Never
   * persisted to storage (issue Takazudo/zudo-sg#255).
   */
  clipboard: CompositionNode | null;
  /**
   * Resolver-supplied policy for a bound consumer's virtual root. It is
   * session-only: canonical documents retain only the source/outlet binding.
   */
  rootPolicy: RootPolicy;
}

/**
 * The typed action union the controller dispatches. `add` deliberately uses
 * Takazudo/zudo-sg#245's shared `InsertionTarget` (`{ parentId, slotId, index }`) — the same
 * shape Takazudo/zudo-sg#248/#250/#251 and the round-2 interaction waves address inserts
 * with, per the epic's locked architecture.
 */
export type ComposerAction =
  | { type: "add"; target: InsertionTarget; componentId: string }
  | { type: "rename"; name: string }
  | { type: "updateProps"; nodeId: string; patch: JsonObject }
  | { type: "reorder"; nodeId: string; direction: "up" | "down" }
  | { type: "remove"; nodeId: string }
  | { type: "copy"; nodeId: string }
  | { type: "cut"; nodeId: string }
  | { type: "paste"; target: InsertionTarget }
  /** Insert a detached Pattern root forest as one atomic document transition. */
  | { type: "insertForest"; target: InsertionTarget; sourceRoots: readonly CompositionNode[] }
  | { type: "duplicate"; nodeId: string }
  | { type: "drop"; sourceNodeId: string; target: InsertionTarget; copy: boolean }
  | { type: "publishPattern" }
  | { type: "publishGlobalTemplate"; target: GlobalTemplateOutletTarget; label: string }
  | { type: "setGlobalTemplateOutlet"; target: GlobalTemplateOutletTarget; label: string }
  | { type: "renameGlobalTemplateOutlet"; label: string }
  | { type: "reassignGlobalTemplateOutlet"; target: GlobalTemplateOutletTarget }
  | { type: "clearPublication"; dependencyGuard: PublicationDependencyGuard }
  | { type: "bindConsumer"; contract: ResolvedGlobalTemplateOutletContract }
  | { type: "removeBinding" }
  | { type: "setRootPolicy"; rootPolicy: RootPolicy }
  | { type: "select"; nodeId: string | null }
  | { type: "reveal"; nodeId: string }
  | { type: "toggleExpanded"; nodeId: string }
  | { type: "setExpanded"; nodeId: string; expanded: boolean }
  | { type: "setMode"; mode: ComposerMode }
  | { type: "setViewport"; viewport: ComposerCanvasViewport }
  | { type: "setLeftWidth"; width: number }
  | { type: "setRightWidth"; width: number }
  | { type: "setSaveStatus"; status: ComposerSaveStatus };

export interface ComposerReducerContext {
  manifest: ComponentCatalog;
  idFactory: IdFactory;
}

export interface ComposerReducerResult {
  state: ComposerControllerState;
  /** Non-null when a document command was rejected (e.g. cardinality/accepts). */
  error: string | null;
  /** True when `document` itself changed — callers use this to trigger persistence. */
  documentChanged: boolean;
}

const DOCUMENT_MUTATION_TYPES = new Set<ComposerAction["type"]>([
  "add",
  "rename",
  "updateProps",
  "reorder",
  "remove",
  "cut",
  "paste",
  "insertForest",
  "duplicate",
  "drop",
  "publishPattern",
  "publishGlobalTemplate",
  "setGlobalTemplateOutlet",
  "renameGlobalTemplateOutlet",
  "reassignGlobalTemplateOutlet",
  "clearPublication",
  "bindConsumer",
  "removeBinding",
]);

/** True for actions that mutate `document` (used by the hook to gate autosave). */
export function isDocumentMutation(action: ComposerAction): boolean {
  return DOCUMENT_MUTATION_TYPES.has(action.type);
}

function withExpanded(
  ids: ReadonlySet<string>,
  nodeId: string,
  expanded: boolean,
): ReadonlySet<string> {
  if (ids.has(nodeId) === expanded) return ids;
  const next = new Set(ids);
  if (expanded) next.add(nodeId);
  else next.delete(nodeId);
  return next;
}

/** Every ancestor id of `nodeId` (nearest first), not including the node itself. */
function ancestorIds(
  document: CompositionDocument,
  manifest: ComponentCatalog,
  nodeId: string,
): string[] {
  const ids: string[] = [];
  let current = findLocation(document, manifest, nodeId);
  while (current && current.parentId !== null) {
    ids.push(current.parentId);
    current = findLocation(document, manifest, current.parentId);
  }
  return ids;
}

/**
 * Build the initial in-memory controller state from an already-resolved
 * document from the active record. Pure — never touches storage itself.
 */
export function createInitialControllerState(options: {
  document: CompositionDocument;
  manifest: ComponentCatalog;
  /** A resolver may supply this when mounting an already-bound consumer. */
  rootPolicy?: RootPolicy;
  saveStatus: ComposerSaveStatus;
  derivedOutput?: CompositionDerivedOutputOutcome | null;
  leftWidth: number;
  rightWidth: number;
}): ComposerControllerState {
  const { document, manifest, rootPolicy, saveStatus, derivedOutput = null, leftWidth, rightWidth } = options;
  return {
    document,
    selectedId: repairSelection(document, manifest, null),
    expandedIds: new Set<string>(),
    mode: "edit",
    viewport: "fluid",
    leftWidth,
    rightWidth,
    saveStatus,
    derivedOutput,
    clipboard: null,
    rootPolicy: effectiveRootPolicy(document, rootPolicy),
  };
}

/**
 * Apply one action to `state`, returning the next state plus a command error
 * (if any) and whether `document` changed. Never throws: a rejected Takazudo/zudo-sg#245
 * command (e.g. "slot does not accept X") is reported via `error` and leaves
 * `state` untouched, matching the model's own `CommandResult` contract.
 */
export function applyComposerAction(
  state: ComposerControllerState,
  action: ComposerAction,
  ctx: ComposerReducerContext,
): ComposerReducerResult {
  switch (action.type) {
    case "rename": {
      if (state.document.name === action.name) {
        return { state, error: null, documentChanged: false };
      }
      return {
        state: { ...state, document: { ...state.document, name: action.name } },
        error: null,
        documentChanged: true,
      };
    }
    case "add": {
      const result = addNode(
        state.document,
        ctx.manifest,
        action.target,
        action.componentId,
        ctx.idFactory,
        state.rootPolicy,
      );
      if (!result.ok) return { state, error: result.error, documentChanged: false };
      return {
        state: { ...state, document: result.document, selectedId: result.selectedId },
        error: null,
        documentChanged: result.changed,
      };
    }
    case "updateProps": {
      const result = updateProps(state.document, ctx.manifest, action.nodeId, action.patch);
      if (!result.ok) return { state, error: result.error, documentChanged: false };
      return {
        state: { ...state, document: result.document, selectedId: result.selectedId },
        error: null,
        documentChanged: result.changed,
      };
    }
    case "reorder": {
      const result = reorderNode(state.document, ctx.manifest, action.nodeId, action.direction);
      if (!result.ok) return { state, error: result.error, documentChanged: false };
      return {
        state: { ...state, document: result.document, selectedId: result.selectedId },
        error: null,
        documentChanged: result.changed,
      };
    }
    case "remove": {
      const result = removeNode(state.document, ctx.manifest, action.nodeId, state.selectedId);
      if (!result.ok) return { state, error: result.error, documentChanged: false };
      return {
        state: { ...state, document: result.document, selectedId: result.selectedId },
        error: null,
        documentChanged: result.changed,
      };
    }
    case "copy": {
      const location = findLocation(state.document, ctx.manifest, action.nodeId);
      if (!location) return { state, error: `Node "${action.nodeId}" not found`, documentChanged: false };
      if (isNodeOpaque(location.node, ctx.manifest)) {
        return {
          state,
          error: `Cannot copy an unavailable node ("${action.nodeId}")`,
          documentChanged: false,
        };
      }
      // Deep-clone into the clipboard NOW — a snapshot, never a live reference,
      // so later edits to the document (including to this very node) can't
      // change what a subsequent paste inserts.
      return {
        state: { ...state, clipboard: cloneJson(location.node) },
        error: null,
        documentChanged: false,
      };
    }
    case "cut": {
      const location = findLocation(state.document, ctx.manifest, action.nodeId);
      if (!location) return { state, error: `Node "${action.nodeId}" not found`, documentChanged: false };
      if (isNodeOpaque(location.node, ctx.manifest)) {
        return {
          state,
          error: `Cannot cut an unavailable node ("${action.nodeId}")`,
          documentChanged: false,
        };
      }
      const clipboard = cloneJson(location.node);
      const removed = removeNode(state.document, ctx.manifest, action.nodeId, state.selectedId);
      if (!removed.ok) return { state, error: removed.error, documentChanged: false };
      return {
        state: {
          ...state,
          document: removed.document,
          selectedId: removed.selectedId,
          clipboard,
        },
        error: null,
        documentChanged: removed.changed,
      };
    }
    case "paste": {
      if (!state.clipboard) return { state, error: "Clipboard is empty", documentChanged: false };
      const clone = cloneSubtreeWithNewIds(state.clipboard, ctx.idFactory);
      const result = insertSubtree(state.document, ctx.manifest, action.target, clone, state.rootPolicy);
      if (!result.ok) return { state, error: result.error, documentChanged: false };
      let nextExpanded: ReadonlySet<string> = state.expandedIds;
      for (const id of ancestorIds(result.document, ctx.manifest, result.selectedId!)) {
        nextExpanded = withExpanded(nextExpanded, id, true);
      }
      return {
        state: {
          ...state,
          document: result.document,
          selectedId: result.selectedId,
          expandedIds: nextExpanded,
        },
        error: null,
        documentChanged: result.changed,
      };
    }
    case "insertForest": {
      const result = insertForest(
        state.document,
        ctx.manifest,
        action.target,
        action.sourceRoots,
        ctx.idFactory,
        state.rootPolicy,
      );
      if (!result.ok) return { state, error: result.error, documentChanged: false };
      let nextExpanded: ReadonlySet<string> = state.expandedIds;
      for (const id of ancestorIds(result.document, ctx.manifest, result.selectedId!)) {
        nextExpanded = withExpanded(nextExpanded, id, true);
      }
      return {
        state: {
          ...state,
          document: result.document,
          selectedId: result.selectedId,
          expandedIds: nextExpanded,
        },
        error: null,
        documentChanged: result.changed,
      };
    }
    case "duplicate": {
      const location = findLocation(state.document, ctx.manifest, action.nodeId);
      if (!location) return { state, error: `Node "${action.nodeId}" not found`, documentChanged: false };
      if (isNodeOpaque(location.node, ctx.manifest)) {
        return {
          state,
          error: `Cannot duplicate an unavailable node ("${action.nodeId}")`,
          documentChanged: false,
        };
      }
      const clone = cloneSubtreeWithNewIds(location.node, ctx.idFactory);
      const target: InsertionTarget = {
        parentId: location.parentId,
        slotId: location.slotId,
        index: location.index + 1,
      };
      const result = insertSubtree(state.document, ctx.manifest, target, clone, state.rootPolicy);
      if (!result.ok) return { state, error: result.error, documentChanged: false };
      let nextExpanded: ReadonlySet<string> = state.expandedIds;
      for (const id of ancestorIds(result.document, ctx.manifest, result.selectedId!)) {
        nextExpanded = withExpanded(nextExpanded, id, true);
      }
      return {
        state: {
          ...state,
          document: result.document,
          selectedId: result.selectedId,
          expandedIds: nextExpanded,
        },
        error: null,
        documentChanged: result.changed,
      };
    }
    case "drop": {
      // The ATOMIC host revalidation for a canvas drag & drop (issue Takazudo/zudo-sg#258): the
      // iframe's highlight was advisory only, so the WHOLE operation is
      // re-checked here and applied through the single model mutation path, or
      // rejected with an honest `error` and NO document change.
      const location = findLocation(state.document, ctx.manifest, action.sourceNodeId);
      if (!location) {
        return { state, error: `Node "${action.sourceNodeId}" not found`, documentChanged: false };
      }

      // Opaque-node policy: opaque nodes may reorder within their OWN slot only —
      // never a cross-slot move and never a copy.
      const sameSlot =
        location.parentId === action.target.parentId && location.slotId === action.target.slotId;
      if (isNodeOpaque(location.node, ctx.manifest) && (action.copy || !sameSlot)) {
        return {
          state,
          error: action.copy
            ? `Cannot copy an unavailable node ("${action.sourceNodeId}")`
            : `Cannot move an unavailable node ("${action.sourceNodeId}") across slots`,
          documentChanged: false,
        };
      }

      // COPY composes Takazudo/zudo-sg#255's clone-with-new-ids + insert-subtree (a fresh,
      // independent clone needs no cycle guard); MOVE relocates the same node ids
      // via Takazudo/zudo-sg#258's moveSubtree (cycle guard + same-slot index adjustment).
      let result: CommandResult;
      if (action.copy) {
        const clone = cloneSubtreeWithNewIds(location.node, ctx.idFactory);
        result = insertSubtree(state.document, ctx.manifest, action.target, clone, state.rootPolicy);
      } else {
        result = moveSubtree(state.document, ctx.manifest, action.sourceNodeId, action.target, state.rootPolicy);
      }
      if (!result.ok) return { state, error: result.error, documentChanged: false };

      // Reveal the moved/new node: select it AND expand its ancestors (same as
      // paste/duplicate). `selectedId` is always present on a successful command.
      let nextExpanded: ReadonlySet<string> = state.expandedIds;
      for (const id of ancestorIds(result.document, ctx.manifest, result.selectedId!)) {
        nextExpanded = withExpanded(nextExpanded, id, true);
      }
      return {
        state: {
          ...state,
          document: result.document,
          selectedId: result.selectedId,
          expandedIds: nextExpanded,
        },
        error: null,
        documentChanged: result.changed,
      };
    }
    case "publishPattern": {
      const result = publishPattern(state.document);
      if (!result.ok) return { state, error: result.error, documentChanged: false };
      return {
        state: { ...state, document: result.document },
        error: null,
        documentChanged: result.changed,
      };
    }
    case "publishGlobalTemplate": {
      const result = publishGlobalTemplate(
        state.document,
        ctx.manifest,
        action.target,
        action.label,
        ctx.idFactory,
      );
      if (!result.ok) return { state, error: result.error, documentChanged: false };
      return {
        state: { ...state, document: result.document },
        error: null,
        documentChanged: result.changed,
      };
    }
    case "setGlobalTemplateOutlet": {
      const result = setGlobalTemplateOutlet(
        state.document,
        ctx.manifest,
        action.target,
        action.label,
        ctx.idFactory,
      );
      if (!result.ok) return { state, error: result.error, documentChanged: false };
      return {
        state: { ...state, document: result.document },
        error: null,
        documentChanged: result.changed,
      };
    }
    case "renameGlobalTemplateOutlet": {
      const result = renameGlobalTemplateOutlet(state.document, action.label);
      if (!result.ok) return { state, error: result.error, documentChanged: false };
      return {
        state: { ...state, document: result.document },
        error: null,
        documentChanged: result.changed,
      };
    }
    case "reassignGlobalTemplateOutlet": {
      const result = reassignGlobalTemplateOutlet(state.document, ctx.manifest, action.target);
      if (!result.ok) return { state, error: result.error, documentChanged: false };
      return {
        state: { ...state, document: result.document },
        error: null,
        documentChanged: result.changed,
      };
    }
    case "clearPublication": {
      const result = clearPublication(state.document, action.dependencyGuard);
      if (!result.ok) return { state, error: result.error, documentChanged: false };
      return {
        state: { ...state, document: result.document },
        error: null,
        documentChanged: result.changed,
      };
    }
    case "bindConsumer": {
      const result = bindConsumer(state.document, action.contract);
      if (!result.ok) return { state, error: result.error, documentChanged: false };
      return {
        state: { ...state, document: result.document, rootPolicy: action.contract.rootPolicy },
        error: null,
        documentChanged: result.changed,
      };
    }
    case "removeBinding": {
      const result = removeBinding(state.document);
      if (!result.ok) return { state, error: result.error, documentChanged: false };
      return {
        state: {
          ...state,
          document: result.document,
          rootPolicy: effectiveRootPolicy(result.document, state.rootPolicy),
        },
        error: null,
        documentChanged: result.changed,
      };
    }
    case "setRootPolicy":
      return {
        state: { ...state, rootPolicy: effectiveRootPolicy(state.document, action.rootPolicy) },
        error: null,
        documentChanged: false,
      };
    case "select":
      return { state: { ...state, selectedId: action.nodeId }, error: null, documentChanged: false };
    case "reveal": {
      let nextExpanded: ReadonlySet<string> = state.expandedIds;
      for (const id of ancestorIds(state.document, ctx.manifest, action.nodeId)) {
        nextExpanded = withExpanded(nextExpanded, id, true);
      }
      return {
        state: { ...state, selectedId: action.nodeId, expandedIds: nextExpanded },
        error: null,
        documentChanged: false,
      };
    }
    case "toggleExpanded":
      return {
        state: {
          ...state,
          expandedIds: withExpanded(state.expandedIds, action.nodeId, !state.expandedIds.has(action.nodeId)),
        },
        error: null,
        documentChanged: false,
      };
    case "setExpanded":
      return {
        state: { ...state, expandedIds: withExpanded(state.expandedIds, action.nodeId, action.expanded) },
        error: null,
        documentChanged: false,
      };
    case "setMode":
      return { state: { ...state, mode: action.mode }, error: null, documentChanged: false };
    case "setViewport":
      return { state: { ...state, viewport: action.viewport }, error: null, documentChanged: false };
    case "setLeftWidth":
      return { state: { ...state, leftWidth: action.width }, error: null, documentChanged: false };
    case "setRightWidth":
      return { state: { ...state, rightWidth: action.width }, error: null, documentChanged: false };
    case "setSaveStatus":
      return { state: { ...state, saveStatus: action.status }, error: null, documentChanged: false };
  }
}

/** True while the document is not known to match its persistence target. */
export function hasUnsavedChanges(state: ComposerControllerState): boolean {
  return state.saveStatus.kind !== "saved";
}

/**
 * A short, honest, user-facing description of `saveStatus` — the single
 * place the toolbar's save indicator sources its provider-neutral copy from.
 */
export function describeSaveStatus(status: ComposerSaveStatus): string {
  switch (status.kind) {
    case "saved":
      return "Saved";
    case "dirty":
      return "Unsaved changes";
    case "saving":
      return "Saving…";
    case "error":
      return "Save failed";
  }
}
