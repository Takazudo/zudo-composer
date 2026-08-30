// Pure Composition commands.
//
// Every command takes a document and returns a NEW document (never mutates the
// input — it clones via a JSON round-trip, then mutates the clone). Commands
// return a discriminated `CommandResult` so callers get either the next
// document + repaired selection, or an actionable error string.
//
// Commands cover sibling movement, cross-slot drop/reparenting, and clipboard
// insertion. Opaque nodes are preserved: they may be reordered/removed within
// their current slot, but their props are read-only and nothing may be added
// into them.

import {
  ContractValidationError,
  RESERVED_PERSISTED_KEYS,
  validateFieldValue,
} from "@zudo-composer/component-contract";
import type {
  ComponentCatalog,
  CompositionBinding,
  CompositionDocument,
  CompositionNode,
  GlobalTemplateOutletTarget,
  InsertionTarget,
  JsonObject,
  PublicationDependencyGuard,
  ResolvedGlobalTemplateOutletContract,
  RootPolicy,
} from "./types";
import type { IdFactory } from "../../shared/id-factory";
import { cloneJson, isJsonSafe } from "../../shared/json";
import { indexDocument } from "./index-model";
import { isSafeRecordId } from "../../shared/record-identity";
import {
  effectiveRootPolicy,
  isNodeOpaque,
  validateInsertionTarget,
  validateRootForest,
  validateRootInsertion,
} from "./validate";
import { validateNodeProps } from "./node-props";

export type CommandResult =
  | {
      ok: true;
      document: CompositionDocument;
      /** Selection the caller should adopt after the command. */
      selectedId: string | null;
      /** Id of the node created by `addNode` (only present on add). */
      insertedId?: string;
      /** False when a command was a valid no-op (e.g. reorder at a boundary). */
      changed: boolean;
    }
  | { ok: false; error: string; code?: CommandErrorCode };

/** Stable codes for policy/reuse rejections; existing command callers may keep using `error`. */
export type CommandErrorCode =
  | "invalid-outlet"
  | "outlet-reserved"
  | "outlet-owner-removal"
  | "publication-conflict"
  | "empty-pattern-root"
  | "dependent-bindings"
  | "invalid-dependency-guard"
  | "binding-conflict"
  | "self-binding"
  | "cross-provider-binding"
  | "nested-binding"
  | "unresolved-root-policy"
  | "root-cardinality"
  | "root-accepts"
  | "invalid-insertion-target"
  | "empty-forest"
  | "forest-component-unavailable"
  | "forest-cardinality"
  | "forest-node-id-collision";

function commandError(code: CommandErrorCode, error: string): CommandResult {
  return { ok: false, code, error };
}

function rootPolicyError(error: string): CommandResult {
  if (/until its Global template outlet is resolved/i.test(error)) {
    return commandError("unresolved-root-policy", error);
  }
  if (/only one root component/i.test(error)) return commandError("root-cardinality", error);
  return commandError("root-accepts", error);
}

function insertionTargetError(error: string): CommandResult {
  if (/Global template outlet is reserved/i.test(error)) return commandError("outlet-reserved", error);
  return { ok: false, error };
}

/** Forest insertion promises a typed reason for every rejection. */
function forestInsertionTargetError(error: string): CommandResult {
  if (/Global template outlet is reserved/i.test(error)) return commandError("outlet-reserved", error);
  return commandError("invalid-insertion-target", error);
}

/** Build a fast id → node lookup over a document. */
function nodeLookup(document: CompositionDocument, manifest: ComponentCatalog) {
  const index = indexDocument(document, manifest);
  return (id: string): CompositionNode | undefined => index.byId.get(id)?.node;
}

/** The mutable slot array an `InsertionTarget`/location addresses in `document`. */
function slotArray(
  document: CompositionDocument,
  parentId: string | null,
  slotId: string,
  locate: (id: string) => CompositionNode | undefined,
): CompositionNode[] | undefined {
  if (parentId === null) return document.root;
  const parent = locate(parentId);
  if (!parent) return undefined;
  if (!Array.isArray(parent.slots[slotId])) parent.slots[slotId] = [];
  return parent.slots[slotId];
}

// ── add ──────────────────────────────────────────────────────────────────────

/**
 * Insert a fresh node of `componentId` into the slot described by `target`, at
 * `target.index` (default append is expressed as `index === slot.length`). The
 * new node's props come from the manifest defaults and its declared slots are
 * initialised to empty arrays. Enforces the target slot's `accepts` whitelist
 * and single-cardinality. Ids are minted by the injected `idFactory`.
 */
export function addNode(
  document: CompositionDocument,
  manifest: ComponentCatalog,
  target: InsertionTarget,
  componentId: string,
  idFactory: IdFactory,
  rootPolicy?: RootPolicy,
): CommandResult {
  const next = cloneJson(document);
  const index = indexDocument(next, manifest);
  const locate = (id: string): CompositionNode | undefined => index.byId.get(id)?.node;

  const validation = validateInsertionTarget(next, manifest, target, locate);
  if (!validation.ok) return insertionTargetError(validation.error ?? "invalid insertion target");

  const entry = manifest.get(componentId);
  if (!entry) {
    return { ok: false, error: `Cannot add unknown component "${componentId}"` };
  }

  if (target.parentId === null) {
    const rootValidation = validateRootInsertion(
      next.root.length,
      componentId,
      effectiveRootPolicy(document, rootPolicy),
    );
    if (!rootValidation.ok) return rootPolicyError(rootValidation.error ?? "invalid consumer root policy");
  }

  // Slot-level acceptance + cardinality. Virtual-root rules come from the
  // effective consumer policy above rather than an unrestricted shortcut.
  if (target.parentId !== null) {
    const parent = locate(target.parentId)!;
    const parentEntry = manifest.get(parent.componentId)!;
    const slot = parentEntry.slots.find((s) => s.id === target.slotId)!;
    const existing = parent.slots[target.slotId] ?? [];
    if (slot.accepts && !slot.accepts.includes(componentId)) {
      return {
        ok: false,
        error: `Slot "${target.slotId}" does not accept "${componentId}"`,
      };
    }
    if (slot.cardinality === "single" && existing.length >= 1) {
      return {
        ok: false,
        error: `Slot "${target.slotId}" is single-child and already occupied`,
      };
    }
  }

  const id = idFactory(componentId);
  if (index.byId.has(id)) {
    return { ok: false, error: `Id factory produced a duplicate id "${id}"` };
  }

  const node: CompositionNode = {
    id,
    componentId,
    componentVersion: entry.schemaVersion,
    props: cloneJson(entry.defaults ?? {}) as JsonObject,
    slots: Object.fromEntries(entry.slots.map((s) => [s.id, [] as CompositionNode[]])),
  };

  const array = slotArray(next, target.parentId, target.slotId, locate)!;
  array.splice(target.index, 0, node);

  return { ok: true, document: next, selectedId: id, insertedId: id, changed: true };
}

// ── update props ───────────────────────────────────────────────────────────

/**
 * Merge a JSON-safe prop patch into a node's props. Rejects opaque nodes
 * (their props are read-only), non-JSON-safe values, values that violate a
 * declared field's kind/domain, any key in `RESERVED_PROP_KEYS` (issue Takazudo/zudo-sg#287 —
 * this is the model-layer counterpart of the preview protocol's wire-level
 * rejection; a direct model caller bypasses that boundary, so the model must
 * refuse it too), and any key that names a declared STRUCTURAL slot's `prop`
 * (that prop is reserved for the slot's rendered children — a scalar written
 * there would sit inert in storage yet claim the same prop the generator
 * binds structural children to). Every resulting scalar prop must satisfy the
 * component manifest's field/static/default contract.
 */
export function updateProps(
  document: CompositionDocument,
  manifest: ComponentCatalog,
  nodeId: string,
  patch: JsonObject,
  removeProps: readonly string[] = [],
): CommandResult {
  const next = cloneJson(document);
  const locate = nodeLookup(next, manifest);
  const node = locate(nodeId);
  if (!node) return { ok: false, error: `Node "${nodeId}" not found` };
  if (isNodeOpaque(node, manifest)) {
    return { ok: false, error: `Node "${nodeId}" is opaque; its props are read-only` };
  }

  const entry = manifest.get(node.componentId)!;
  const fieldsByProp = new Map(entry.fields.map((f) => [f.prop, f]));
  const slotProps = new Set(entry.slots.map((s) => s.prop));
  const removeSet = new Set(removeProps);

  if (removeSet.size !== removeProps.length) {
    return { ok: false, error: "A prop cannot be removed more than once" };
  }

  for (const prop of removeProps) {
    if (RESERVED_PERSISTED_KEYS.includes(prop as (typeof RESERVED_PERSISTED_KEYS)[number])) {
      return { ok: false, error: `Prop "${prop}" is a reserved key and cannot be removed` };
    }
    if (slotProps.has(prop)) {
      return {
        ok: false,
        error: `Prop "${prop}" is a structural slot on "${node.componentId}" and cannot be removed as a scalar prop`,
      };
    }
    const field = fieldsByProp.get(prop);
    if (field?.required === true) {
      return { ok: false, error: `Prop "${prop}" is required and cannot be removed` };
    }
    if (Object.hasOwn(patch, prop)) {
      return { ok: false, error: `Prop "${prop}" cannot be updated and removed in the same command` };
    }
  }

  for (const [prop, value] of Object.entries(patch)) {
    if (RESERVED_PERSISTED_KEYS.includes(prop as (typeof RESERVED_PERSISTED_KEYS)[number])) {
      return {
        ok: false,
        error: `Prop "${prop}" is a reserved key and cannot be set`,
      };
    }
    if (slotProps.has(prop)) {
      return {
        ok: false,
        error: `Prop "${prop}" is a structural slot on "${node.componentId}" and cannot be set as a scalar prop`,
      };
    }
    if (!isJsonSafe(value)) {
      return { ok: false, error: `Prop "${prop}" value is not JSON-safe` };
    }
    const field = fieldsByProp.get(prop);
    if (field) {
      try {
        validateFieldValue(field, value, `$props.${prop}`);
      } catch (error) {
        if (error instanceof ContractValidationError) {
          return { ok: false, error: `Prop "${prop}" is invalid: ${error.message}` };
        }
        throw error;
      }
    }
  }

  const nextProps = { ...node.props, ...(cloneJson(patch) as JsonObject) };
  for (const prop of removeProps) delete nextProps[prop];
  const propsValidation = validateNodeProps({ componentId: node.componentId, props: nextProps }, entry);
  if (!propsValidation.ok) return { ok: false, error: propsValidation.issues[0]!.message };
  const changed = Object.keys(patch).some((prop) => !Object.is(node.props[prop], patch[prop]))
    || removeProps.some((prop) => Object.hasOwn(node.props, prop));
  node.props = nextProps;
  return { ok: true, document: next, selectedId: nodeId, changed };
}

// ── reorder (sibling up/down within one parent slot) ─────────────────────────

/**
 * Swap a node with its previous ("up") or next ("down") sibling in the SAME
 * parent slot. A move at the slot boundary is a valid no-op (`changed: false`).
 * Allowed for opaque nodes (movement stays within the current slot).
 */
export function reorderNode(
  document: CompositionDocument,
  manifest: ComponentCatalog,
  nodeId: string,
  direction: "up" | "down",
): CommandResult {
  const next = cloneJson(document);
  const index = indexDocument(next, manifest);
  const location = index.byId.get(nodeId);
  if (!location) return { ok: false, error: `Node "${nodeId}" not found` };

  const array =
    location.parentId === null
      ? next.root
      : (index.byId.get(location.parentId)!.node.slots[location.slotId] ?? []);

  const from = location.index;
  const to = direction === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= array.length) {
    return { ok: true, document: next, selectedId: nodeId, changed: false };
  }

  [array[from], array[to]] = [array[to], array[from]];
  return { ok: true, document: next, selectedId: nodeId, changed: true };
}

// ── remove subtree + selection repair ────────────────────────────────────────

/** Collect the id of a node and every descendant. */
function subtreeIds(node: CompositionNode, acc: Set<string> = new Set()): Set<string> {
  acc.add(node.id);
  for (const children of Object.values(node.slots)) {
    for (const child of children) subtreeIds(child, acc);
  }
  return acc;
}

/**
 * Reject deleting the exposed outlet's owner or any ancestor. Removing either
 * would leave persisted publication metadata pointing at a nonexistent slot;
 * callers must first reassign the outlet or clear publication explicitly.
 */
function outletRemovalError(
  document: CompositionDocument,
  manifest: ComponentCatalog,
  nodeId: string,
): CommandResult | null {
  const publication = document.publication;
  if (publication?.kind !== "global-template") return null;

  const index = indexDocument(document, manifest);
  let currentId: string | null = publication.outlet.target.parentId;
  while (currentId !== null) {
    if (currentId === nodeId) {
      return commandError(
        "outlet-owner-removal",
        "Cannot remove a Global template outlet owner or its ancestor until the outlet is reassigned or publication is cleared",
      );
    }
    currentId = index.byId.get(currentId)?.parentId ?? null;
  }
  return null;
}

function patternRootRemovalError(
  document: CompositionDocument,
  nodeId: string,
  locationParentId: string | null,
): CommandResult | null {
  if (
    document.publication?.kind === "pattern"
    && locationParentId === null
    && document.root.length === 1
    && document.root[0]?.id === nodeId
  ) {
    return commandError(
      "empty-pattern-root",
      "A published Pattern must retain at least one root component; clear publication before removing its last root",
    );
  }
  return null;
}

/**
 * Remove a node (and its whole subtree) from its parent slot. Returns a repaired
 * selection: if the current selection survived the removal it is kept; otherwise
 * it falls back to the sibling that shifts into the removed slot index, then the
 * previous sibling, then the parent node, then null (empty root). The virtual
 * root cannot be removed (it has no id).
 */
export function removeNode(
  document: CompositionDocument,
  manifest: ComponentCatalog,
  nodeId: string,
  selectedId: string | null = null,
): CommandResult {
  const next = cloneJson(document);
  const index = indexDocument(next, manifest);
  const location = index.byId.get(nodeId);
  if (!location) return { ok: false, error: `Node "${nodeId}" not found` };

  const outletGuard = outletRemovalError(document, manifest, nodeId);
  if (outletGuard) return outletGuard;
  const patternGuard = patternRootRemovalError(document, nodeId, location.parentId);
  if (patternGuard) return patternGuard;

  const array =
    location.parentId === null
      ? next.root
      : (index.byId.get(location.parentId)!.node.slots[location.slotId] ?? []);

  const removed = subtreeIds(location.node);
  const selectionSurvives = selectedId !== null && !removed.has(selectedId);

  array.splice(location.index, 1);

  let repaired: string | null;
  if (selectionSurvives) {
    repaired = selectedId;
  } else if (array.length > 0) {
    const at = Math.min(location.index, array.length - 1);
    repaired = array[at].id;
  } else {
    repaired = location.parentId; // null when the removed node was at the root
  }

  return { ok: true, document: next, selectedId: repaired, changed: true };
}

/**
 * Repair an arbitrary selection against a (possibly replaced) document: keep it
 * if the node still exists, else fall back to the first root node, else null.
 * Used after a whole-document swap (load/reset/recovery), where the location of
 * a since-removed node is unknown.
 */
export function repairSelection(
  document: CompositionDocument,
  manifest: ComponentCatalog,
  selectedId: string | null,
): string | null {
  if (selectedId !== null && indexDocument(document, manifest).byId.has(selectedId)) {
    return selectedId;
  }
  return document.root[0]?.id ?? null;
}

// ── Publication / outlet / binding commands (Composition reuse) ────────────

function outletTargetError(
  document: CompositionDocument,
  manifest: ComponentCatalog,
  target: GlobalTemplateOutletTarget,
): CommandResult | null {
  const index = indexDocument(document, manifest);
  const parent = index.byId.get(target.parentId)?.node;
  if (!parent) {
    return commandError(
      "invalid-outlet",
      `Global template outlet owner "${target.parentId}" was not found`,
    );
  }
  if (isNodeOpaque(parent, manifest)) {
    return commandError(
      "invalid-outlet",
      `Global template outlet owner "${target.parentId}" is unavailable or structurally invalid`,
    );
  }
  const entry = manifest.get(parent.componentId)!;
  if (!entry.slots.some((slot) => slot.id === target.slotId)) {
    return commandError(
      "invalid-outlet",
      `Global template outlet "${target.slotId}" is not a declared slot on "${parent.componentId}"`,
    );
  }
  if ((parent.slots[target.slotId] ?? []).length > 0) {
    return commandError(
      "invalid-outlet",
      "A Global template outlet must be an empty declared component slot",
    );
  }
  return null;
}

function withoutPublication(document: CompositionDocument): CompositionDocument {
  const next = { ...document };
  delete next.publication;
  return next;
}

function withoutBinding(document: CompositionDocument): CompositionDocument {
  const next = { ...document };
  delete next.binding;
  return next;
}

function validDependencyGuard(guard: PublicationDependencyGuard | undefined): boolean {
  return guard !== undefined && Number.isInteger(guard.dependentCount) && guard.dependentCount >= 0;
}

/** Explicitly publish a non-empty local Composition as a detached-clone Pattern. */
export function publishPattern(document: CompositionDocument): CommandResult {
  if (document.binding) {
    return commandError(
      "publication-conflict",
      "A bound Composition cannot be published; remove its binding first",
    );
  }
  if (document.publication?.kind === "global-template") {
    return commandError(
      "publication-conflict",
      "Clear Global template publication before publishing this Composition as a Pattern",
    );
  }
  if (document.root.length === 0) {
    return commandError("empty-pattern-root", "A Pattern needs at least one root component before publication");
  }
  if (document.publication?.kind === "pattern") {
    return { ok: true, document: cloneJson(document), selectedId: null, changed: false };
  }
  return {
    ok: true,
    document: { ...cloneJson(document), publication: { kind: "pattern" } },
    selectedId: null,
    changed: true,
  };
}

/**
 * Explicitly publish as a Global template. The outlet id is minted exactly
 * once here; later label edits and target reassignment retain this id.
 */
export function publishGlobalTemplate(
  document: CompositionDocument,
  manifest: ComponentCatalog,
  target: GlobalTemplateOutletTarget,
  label: string,
  idFactory: IdFactory,
): CommandResult {
  if (document.binding) {
    return commandError(
      "publication-conflict",
      "A bound Composition cannot be published; remove its binding first",
    );
  }
  if (document.publication) {
    return commandError(
      "publication-conflict",
      document.publication.kind === "pattern"
        ? "Clear Pattern publication before publishing this Composition as a Global template"
        : "This Composition is already a Global template; reassign its outlet instead",
    );
  }
  const targetError = outletTargetError(document, manifest, target);
  if (targetError) return targetError;
  const outletId = idFactory("outlet");
  if (outletId.length === 0) {
    return commandError("invalid-outlet", "Outlet id factory produced an empty id");
  }
  return {
    ok: true,
    document: {
      ...cloneJson(document),
      publication: {
        kind: "global-template",
        outlet: { id: outletId, label, target: cloneJson(target) },
      },
    },
    selectedId: null,
    changed: true,
  };
}

/** Change the human label of a published Global template's stable outlet. */
export function renameGlobalTemplateOutlet(
  document: CompositionDocument,
  label: string,
): CommandResult {
  if (document.publication?.kind !== "global-template") {
    return commandError("invalid-outlet", "This Composition is not published as a Global template");
  }
  if (document.publication.outlet.label === label) {
    return { ok: true, document: cloneJson(document), selectedId: null, changed: false };
  }
  return {
    ok: true,
    document: {
      ...cloneJson(document),
      publication: {
        ...document.publication,
        outlet: { ...document.publication.outlet, label },
      },
    },
    selectedId: null,
    changed: true,
  };
}

/** Reassign the outlet target without changing its stable source-scoped id. */
export function reassignGlobalTemplateOutlet(
  document: CompositionDocument,
  manifest: ComponentCatalog,
  target: GlobalTemplateOutletTarget,
): CommandResult {
  if (document.publication?.kind !== "global-template") {
    return commandError("invalid-outlet", "This Composition is not published as a Global template");
  }
  const targetError = outletTargetError(document, manifest, target);
  if (targetError) return targetError;
  const previous = document.publication.outlet.target;
  if (previous.parentId === target.parentId && previous.slotId === target.slotId) {
    return { ok: true, document: cloneJson(document), selectedId: null, changed: false };
  }
  return {
    ok: true,
    document: {
      ...cloneJson(document),
      publication: {
        ...document.publication,
        outlet: { ...document.publication.outlet, target: cloneJson(target) },
      },
    },
    selectedId: null,
    changed: true,
  };
}

/**
 * Create or update a Global template outlet through one explicit command.
 * Existing Global templates keep their outlet id; this is useful to a compact
 * authoring UI that changes target and label in one state transition.
 */
export function setGlobalTemplateOutlet(
  document: CompositionDocument,
  manifest: ComponentCatalog,
  target: GlobalTemplateOutletTarget,
  label: string,
  idFactory: IdFactory,
): CommandResult {
  if (document.publication?.kind !== "global-template") {
    return publishGlobalTemplate(document, manifest, target, label, idFactory);
  }
  const targetError = outletTargetError(document, manifest, target);
  if (targetError) return targetError;
  const outlet = document.publication.outlet;
  const targetChanged = outlet.target.parentId !== target.parentId || outlet.target.slotId !== target.slotId;
  const labelChanged = outlet.label !== label;
  if (!targetChanged && !labelChanged) {
    return { ok: true, document: cloneJson(document), selectedId: null, changed: false };
  }
  return {
    ok: true,
    document: {
      ...cloneJson(document),
      publication: {
        ...document.publication,
        outlet: {
          ...outlet,
          label,
          target: cloneJson(target),
        },
      },
    },
    selectedId: null,
    changed: true,
  };
}

/** Clear a source role only after the owner service has checked dependents. */
export function clearPublication(
  document: CompositionDocument,
  dependencyGuard: PublicationDependencyGuard,
): CommandResult {
  if (!document.publication) {
    return { ok: true, document: cloneJson(document), selectedId: null, changed: false };
  }
  if (!validDependencyGuard(dependencyGuard)) {
    return commandError(
      "invalid-dependency-guard",
      "Clearing publication requires a current dependent-count guard from the owning service",
    );
  }
  const dependentCount = dependencyGuard.dependentCount;
  if (document.publication.kind === "global-template" && dependentCount > 0) {
    return commandError(
      "dependent-bindings",
      "Cannot clear Global template publication while consumers are still bound to it",
    );
  }
  return { ok: true, document: withoutPublication(cloneJson(document)), selectedId: null, changed: true };
}

/** Bind this canonical local root to a successfully resolved Global source outlet. */
export function bindConsumer(
  document: CompositionDocument,
  contract: ResolvedGlobalTemplateOutletContract,
  containingRecordId: string = document.id,
): CommandResult {
  if (document.publication) {
    return commandError(
      "binding-conflict",
      "A published Composition cannot bind to a Global template; clear publication first",
    );
  }
  if (document.binding) {
    return commandError("binding-conflict", "This Composition is already bound; remove its binding before binding again");
  }
  if (!contract.sameProvider) {
    return commandError("cross-provider-binding", "Global template bindings must use the current provider");
  }
  if (contract.sourceRecordId === containingRecordId) {
    return commandError("self-binding", "A Composition cannot bind to itself as a Global template source");
  }
  if (!contract.sourceIsGlobalTemplate) {
    return commandError("binding-conflict", "The resolved source is not published as a Global template");
  }
  if (contract.sourceHasBinding) {
    return commandError("nested-binding", "A Global template source cannot itself be bound to another template");
  }
  if (!isSafeRecordId(contract.sourceRecordId) || !contract.outletId) {
    return commandError("binding-conflict", "A resolved Global template source and outlet id are required");
  }
  if (contract.rootPolicy?.kind !== "resolved") {
    return commandError(
      "unresolved-root-policy",
      "Binding requires the resolved Global template outlet constraints",
    );
  }
  const rootValidation = validateRootForest(document.root, contract.rootPolicy);
  if (!rootValidation.ok) return rootPolicyError(rootValidation.error ?? "invalid consumer root policy");

  const binding: CompositionBinding = {
    sourceRecordId: contract.sourceRecordId,
    outletId: contract.outletId,
  };
  return {
    ok: true,
    document: { ...cloneJson(document), binding },
    selectedId: null,
    changed: true,
  };
}

/** Remove a live binding while retaining every canonical local root node. */
export function removeBinding(document: CompositionDocument): CommandResult {
  if (!document.binding) {
    return { ok: true, document: cloneJson(document), selectedId: null, changed: false };
  }
  return { ok: true, document: withoutBinding(cloneJson(document)), selectedId: null, changed: true };
}

// ── clipboard/duplicate commands ──────────────────────
//
// Two pure primitives the Takazudo/zudo-sg#247 controller composes into copy/cut/paste/
// duplicate: `cloneSubtreeWithNewIds` never touches a document (it only
// re-issues ids on a detached node tree), and `insertSubtree` inserts an
// already-built subtree — as opposed to `addNode`, which builds a fresh node
// from manifest defaults. Splitting them this way is what lets the controller
// paste (clone, then insert) and duplicate (clone, then insert right after the
// source) share the exact same insertion validation `addNode` uses.

/**
 * Deep-clone `node` and every descendant, re-issuing every node's `id` via
 * `idFactory` — componentId/componentVersion/props/slot structure are
 * preserved verbatim. Never mutates `node`; the result shares no references
 * with it. Two calls against the same source (e.g. pasting the same clipboard
 * twice) always produce fully distinct id sets, since `idFactory` mints a
 * fresh id on every invocation.
 */
export function cloneSubtreeWithNewIds(node: CompositionNode, idFactory: IdFactory): CompositionNode {
  return cloneForestWithNewIds([node], idFactory).roots[0]!;
}

/** A detached root forest plus the complete old-node-id → new-node-id mapping. */
export interface ClonedForestWithNewIds {
  roots: CompositionNode[];
  idMap: ReadonlyMap<string, string>;
}

/**
 * Deep-clone a non-empty root forest, re-issuing every node identity exactly
 * once. The returned map is deliberately part of the primitive: document
 * duplication uses it to repair metadata that names a cloned node (for
 * example, a Global template outlet owner).
 *
 * A duplicate id in the source or an id factory result that is not genuinely
 * fresh is an invalid source/factory contract, so this primitive rejects it
 * before returning a partially cloned forest. `insertForest` turns the same
 * condition into its typed command error for UI callers.
 */
export function cloneForestWithNewIds(
  roots: readonly CompositionNode[],
  idFactory: IdFactory,
): ClonedForestWithNewIds {
  if (roots.length === 0) {
    throw new Error("Cannot clone an empty component forest");
  }

  const sourceIds = new Set<string>();
  const collectSourceIds = (node: CompositionNode): void => {
    if (sourceIds.has(node.id)) {
      throw new Error(`Cannot clone a forest with duplicate source node id "${node.id}"`);
    }
    sourceIds.add(node.id);
    for (const children of Object.values(node.slots)) {
      for (const child of children) collectSourceIds(child);
    }
  };
  for (const root of roots) collectSourceIds(root);

  const idMap = new Map<string, string>();
  const clonedIds = new Set<string>();
  const detached = cloneJson(roots) as CompositionNode[];
  const reissueIds = (node: CompositionNode): CompositionNode => {
    const id = idFactory(node.componentId);
    if (sourceIds.has(id) || clonedIds.has(id)) {
      throw new Error(`Id factory produced a non-fresh forest node id "${id}"`);
    }
    clonedIds.add(id);
    idMap.set(node.id, id);
    const slots: Record<string, CompositionNode[]> = {};
    for (const [slotId, children] of Object.entries(node.slots)) {
      slots[slotId] = children.map(reissueIds);
    }
    return { ...node, id, slots };
  };

  return { roots: detached.map(reissueIds), idMap };
}

/**
 * Atomically clone and insert a saved Pattern's root forest. Every target,
 * source-root, cardinality, policy, and identity condition is checked before
 * the destination document is cloned and spliced, so a failed multi-root
 * insertion can never leave a valid prefix behind.
 */
export function insertForest(
  document: CompositionDocument,
  manifest: ComponentCatalog,
  target: InsertionTarget,
  sourceRoots: readonly CompositionNode[],
  idFactory: IdFactory,
  rootPolicy?: RootPolicy,
): CommandResult {
  if (sourceRoots.length === 0) {
    return commandError("empty-forest", "Cannot insert an empty Pattern component forest");
  }

  const index = indexDocument(document, manifest);
  const locate = (id: string): CompositionNode | undefined => index.byId.get(id)?.node;
  const targetValidation = validateInsertionTarget(document, manifest, target, locate);
  if (!targetValidation.ok) {
    return forestInsertionTargetError(targetValidation.error ?? "invalid insertion target");
  }

  for (const root of sourceRoots) {
    if (!manifest.has(root.componentId)) {
      return commandError(
        "forest-component-unavailable",
        `Cannot insert Pattern root "${root.componentId}" because that component is unavailable`,
      );
    }
  }

  if (target.parentId === null) {
    const rootValidation = validateRootForest(
      [...document.root, ...sourceRoots],
      effectiveRootPolicy(document, rootPolicy),
    );
    if (!rootValidation.ok) return rootPolicyError(rootValidation.error ?? "invalid consumer root policy");
  } else {
    const parent = locate(target.parentId)!;
    const parentEntry = manifest.get(parent.componentId)!;
    const slot = parentEntry.slots.find((candidate) => candidate.id === target.slotId)!;
    const existing = parent.slots[target.slotId] ?? [];
    if (slot.accepts) {
      for (const root of sourceRoots) {
        if (!slot.accepts.includes(root.componentId)) {
          return commandError(
            "root-accepts",
            `Slot "${target.slotId}" does not accept "${root.componentId}"`,
          );
        }
      }
    }
    if (slot.cardinality === "single" && (existing.length !== 0 || sourceRoots.length !== 1)) {
      return commandError(
        "forest-cardinality",
        `Slot "${target.slotId}" is single-child and requires exactly one root in an empty slot`,
      );
    }
  }

  let cloned: ClonedForestWithNewIds;
  try {
    cloned = cloneForestWithNewIds(sourceRoots, idFactory);
  } catch (error) {
    return commandError(
      "forest-node-id-collision",
      error instanceof Error ? error.message : "Could not create fresh node ids for the Pattern forest",
    );
  }

  for (const id of cloned.idMap.values()) {
    if (index.byId.has(id)) {
      return commandError(
        "forest-node-id-collision",
        `Pattern clone node id "${id}" already exists in the destination document`,
      );
    }
  }

  const next = cloneJson(document);
  const nextIndex = indexDocument(next, manifest);
  const nextLocate = (id: string): CompositionNode | undefined => nextIndex.byId.get(id)?.node;
  const array = slotArray(next, target.parentId, target.slotId, nextLocate)!;
  array.splice(target.index, 0, ...cloned.roots);

  const insertedId = cloned.roots[0]!.id;
  return { ok: true, document: next, selectedId: insertedId, insertedId, changed: true };
}

/**
 * Insert an already-built subtree (its ids already final — see
 * `cloneSubtreeWithNewIds`) into the slot described by `target`. Validates the
 * target's slot acceptance, cardinality, index bounds, and root-slot schema
 * exactly like `addNode` — BEFORE applying anything — and additionally refuses
 * to insert if any id in `subtree` already exists in `document` (an invariant
 * violation; callers are expected to have re-issued ids first). Never mutates
 * `document` or `subtree`.
 */
export function insertSubtree(
  document: CompositionDocument,
  manifest: ComponentCatalog,
  target: InsertionTarget,
  subtree: CompositionNode,
  rootPolicy?: RootPolicy,
): CommandResult {
  const next = cloneJson(document);
  const index = indexDocument(next, manifest);
  const locate = (id: string): CompositionNode | undefined => index.byId.get(id)?.node;

  const validation = validateInsertionTarget(next, manifest, target, locate);
  if (!validation.ok) return insertionTargetError(validation.error ?? "invalid insertion target");

  if (target.parentId === null) {
    const rootValidation = validateRootInsertion(
      next.root.length,
      subtree.componentId,
      effectiveRootPolicy(document, rootPolicy),
    );
    if (!rootValidation.ok) return rootPolicyError(rootValidation.error ?? "invalid consumer root policy");
  }

  // Slot-level acceptance + cardinality. Virtual-root rules are handled by the
  // effective consumer policy above.
  if (target.parentId !== null) {
    const parent = locate(target.parentId)!;
    const parentEntry = manifest.get(parent.componentId)!;
    const slot = parentEntry.slots.find((s) => s.id === target.slotId)!;
    const existing = parent.slots[target.slotId] ?? [];
    if (slot.accepts && !slot.accepts.includes(subtree.componentId)) {
      return {
        ok: false,
        error: `Slot "${target.slotId}" does not accept "${subtree.componentId}"`,
      };
    }
    if (slot.cardinality === "single" && existing.length >= 1) {
      return {
        ok: false,
        error: `Slot "${target.slotId}" is single-child and already occupied`,
      };
    }
  }

  const clone = cloneJson(subtree) as CompositionNode;
  for (const id of subtreeIds(clone)) {
    if (index.byId.has(id)) {
      return { ok: false, error: `Node id "${id}" already exists in the document` };
    }
  }

  const array = slotArray(next, target.parentId, target.slotId, locate)!;
  array.splice(target.index, 0, clone);

  return { ok: true, document: next, selectedId: clone.id, insertedId: clone.id, changed: true };
}

// ── move (cross-slot drag & drop) ────────────────────────
//
// Relocate an EXISTING node (with its whole subtree) from wherever it currently
// sits to an `InsertionTarget`. This is the MOVE half of drag & drop; the COPY
// half composes `cloneSubtreeWithNewIds` + `insertSubtree` instead (a fresh
// clone needs no cycle guard and no index adjustment because the source is not
// removed). The controller (Takazudo/zudo-sg#247) picks between them from the drop's Alt flag,
// and layers the opaque-node policy on top — this function is purely mechanical.

/**
 * Move `sourceNodeId` (and its subtree) to `target`, removing it from its
 * current slot first. Pure — returns a NEW document, never mutates the input.
 *
 * Two subtleties this function owns, both verified by the Takazudo/zudo-sg#242 interaction
 * prototype (see its README):
 *
 *  1. **Same-slot index adjustment.** The adjustment applies ONLY when the
 *     source and destination are the SAME slot (same parent AND same slot id) —
 *     same parent is NOT sufficient, because a `SplitLayout` left→right move
 *     shares a parent but crosses slots. Within one slot, removing the source
 *     shifts every later sibling down by one, so a target index that sat AFTER
 *     the source is decremented by one; otherwise the raw index is used.
 *
 *  2. **Descendant-cycle guard.** A target whose parent is the moved node itself
 *     or any of its descendants is rejected: the destination would be reparented
 *     under a subtree that is about to be detached, orphaning it.
 *
 * Slot acceptance and single-cardinality are both enforced ONLY for a
 * cross-slot move — a same-slot reorder changes no slot membership (the node
 * already lives there), so it can neither violate an `accepts` list it already
 * satisfied nor exceed cardinality, and this is what lets an opaque node (whose
 * `componentId` no `accepts` list names) reorder within its OWN slot, matching
 * `reorderNode`'s identical assumption. A same-slot move whose adjusted index
 * equals the source index is a valid no-op (`changed: false`).
 */
export function moveSubtree(
  document: CompositionDocument,
  manifest: ComponentCatalog,
  sourceNodeId: string,
  target: InsertionTarget,
  rootPolicy?: RootPolicy,
): CommandResult {
  const next = cloneJson(document);
  const index = indexDocument(next, manifest);
  const locate = (id: string): CompositionNode | undefined => index.byId.get(id)?.node;

  const source = index.byId.get(sourceNodeId);
  if (!source) return { ok: false, error: `Node "${sourceNodeId}" not found` };

  // Descendant-cycle guard: the destination parent may not be the moved node
  // itself or any node inside its subtree (that would orphan the destination).
  const movedIds = subtreeIds(source.node);
  if (target.parentId !== null && movedIds.has(target.parentId)) {
    return { ok: false, error: `Cannot move "${sourceNodeId}" into its own subtree` };
  }

  const validation = validateInsertionTarget(next, manifest, target, locate);
  if (!validation.ok) return insertionTargetError(validation.error ?? "invalid insertion target");

  // Same SLOT — not merely same parent (SplitLayout left→right shares a parent
  // but crosses slots, so it must NOT get the same-slot index adjustment).
  const sameSlot = source.parentId === target.parentId && source.slotId === target.slotId;

  // Reordering an existing root stays safe even when the bound policy is
  // unresolved or an externally evolved source no longer accepts that root.
  // Crossing INTO the virtual root is a fresh root insertion and must obey the
  // actual exposed outlet policy before any detach happens.
  if (!sameSlot && target.parentId === null) {
    const rootValidation = validateRootInsertion(
      next.root.length,
      source.node.componentId,
      effectiveRootPolicy(document, rootPolicy),
    );
    if (!rootValidation.ok) return rootPolicyError(rootValidation.error ?? "invalid consumer root policy");
  }

  // A published Pattern must not become empty through a root → named-slot move.
  if (!sameSlot && source.parentId === null && target.parentId !== null) {
    const patternGuard = patternRootRemovalError(document, sourceNodeId, source.parentId);
    if (patternGuard) return patternGuard;
  }

  // Slot acceptance and cardinality are both checked ONLY on a CROSS-slot move
  // — a same-slot reorder does not change slot membership (the node already
  // lives there, already having passed both checks when it was first inserted;
  // `reorderNode`'s sibling swap makes the identical assumption). This is what
  // lets an opaque node — whose `componentId` no legitimate `accepts` list can
  // ever name — reorder within its OWN slot: same-slot is a pure position
  // change, never a fresh membership decision.
  if (!sameSlot && target.parentId !== null) {
    const parent = locate(target.parentId)!;
    const parentEntry = manifest.get(parent.componentId)!;
    const slot = parentEntry.slots.find((s) => s.id === target.slotId)!;
    if (slot.accepts && !slot.accepts.includes(source.node.componentId)) {
      return {
        ok: false,
        error: `Slot "${target.slotId}" does not accept "${source.node.componentId}"`,
      };
    }
    if (slot.cardinality === "single" && (parent.slots[target.slotId] ?? []).length >= 1) {
      return {
        ok: false,
        error: `Slot "${target.slotId}" is single-child and already occupied`,
      };
    }
  }

  // Remove the source subtree from its current slot, then insert it at the
  // (possibly adjusted) target index. When same-slot, both `slotArray` calls
  // resolve to the SAME array object, so the splice-out/splice-in run on it.
  const sourceArray = slotArray(next, source.parentId, source.slotId, locate)!;
  const [detached] = sourceArray.splice(source.index, 1);

  const insertIndex = sameSlot && source.index < target.index ? target.index - 1 : target.index;
  const targetArray = slotArray(next, target.parentId, target.slotId, locate)!;
  targetArray.splice(insertIndex, 0, detached);

  const changed = !(sameSlot && insertIndex === source.index);
  return { ok: true, document: next, selectedId: sourceNodeId, changed };
}
