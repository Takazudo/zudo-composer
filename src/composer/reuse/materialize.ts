// Pure Global-template materialization.
//
// A live binding deliberately remains two canonical documents. This module is
// the only place that projects those documents together: once for a transient
// runtime view (with explicit branch ownership), and once for an explicitly
// requested standalone snapshot (with every node id re-issued). Neither path
// mutates or returns a reference into either canonical input document.

import type { IdFactory } from "../../shared/id-factory";
import { cloneJson } from "../../shared/json";
import type {
  CompositionBinding,
  CompositionDocument,
  CompositionNode,
  GlobalTemplateOutlet,
} from "../model/types";
import { VIRTUAL_ROOT_SLOT_ID } from "../model/types";
import { isStructurallyValidDocument } from "../model/validate";
import type { CompositionRecord } from "../library/types";
import type { GlobalTemplateResolutionOutcome } from "./types";

/** A runtime-only owner. It is never persisted in a Composition document. */
export type MaterializedRuntimeOwner =
  | {
      kind: "local";
      /** The consumer record whose controller may mutate this branch. */
      recordId: string;
      /** Stable, collision-safe namespace for Preact keys and DOM identity. */
      namespace: string;
    }
  | {
      kind: "global-template";
      /** The resolved source record; this branch is read-only in the consumer. */
      sourceRecordId: string;
      /** Stable, collision-safe namespace for Preact keys and DOM identity. */
      namespace: string;
    };

/**
 * A clone of one rendered component node. `id` remains the canonical node id;
 * `runtimeKey` is the only identity suitable for a mixed source/local tree.
 */
export interface MaterializedViewNode {
  id: string;
  componentId: string;
  componentVersion: number;
  props: CompositionNode["props"];
  slots: Record<string, MaterializedViewNode[]>;
  owner: MaterializedRuntimeOwner;
  runtimeKey: string;
}

/** The one legal local insertion surface while rendering a linked template. */
export interface MaterializedLocalRootTarget {
  owner: Extract<MaterializedRuntimeOwner, { kind: "local" }>;
  parentId: null;
  slotId: typeof VIRTUAL_ROOT_SLOT_ID;
}

export interface MaterializedViewOutput {
  preview: "available" | "blocked";
  export: "available" | "blocked";
}

export interface BlockedMaterializedViewOutput {
  preview: "blocked";
  export: "blocked";
}

export interface MaterializedViewAffordances {
  retry: boolean;
  /** Snapshot is possible only for a currently resolved source/outlet. */
  detach: "none" | "snapshot" | "remove-broken-binding";
}

export interface BrokenBindingAffordances {
  retry: true;
  detach: "remove-broken-binding";
}

export type GlobalTemplateViewDiagnosticCode = Exclude<
  GlobalTemplateResolutionOutcome["status"],
  "unbound" | "resolved"
> | "invalid-materialization";

/** A stable, UI-neutral diagnostic for a binding that cannot render linked. */
export interface GlobalTemplateViewDiagnostic {
  code: GlobalTemplateViewDiagnosticCode;
  message: string;
  binding: CompositionBinding;
  output: BlockedMaterializedViewOutput;
  affordances: BrokenBindingAffordances;
}

interface MaterializedLocalView {
  /** A JSON clone of the consumer's canonical document. */
  localDocument: CompositionDocument;
  localRuntime: Extract<MaterializedRuntimeOwner, { kind: "local" }>;
  /** Bare local content for an ordinary or blocked binding. */
  renderRoot: MaterializedViewNode[];
}

/** An ordinary unbound Composition rendered from its local document alone. */
export interface UnboundMaterializedView extends MaterializedLocalView {
  status: "local";
  output: MaterializedViewOutput;
  affordances: MaterializedViewAffordances;
}

/** A fully resolved source shell with the local root projected at its outlet. */
export interface ResolvedGlobalTemplateView extends MaterializedLocalView {
  status: "resolved";
  output: MaterializedViewOutput;
  affordances: MaterializedViewAffordances;
  sourceDocument: CompositionDocument;
  sourceRuntime: Extract<MaterializedRuntimeOwner, { kind: "global-template" }>;
  outlet: GlobalTemplateOutlet;
  /** Local mutations always address the consumer's virtual root, never a source slot. */
  localRootTarget: MaterializedLocalRootTarget;
}

/** A failed binding retains local editing and its original binding, but blocks derived output. */
export interface BlockedGlobalTemplateView extends MaterializedLocalView {
  status: "blocked";
  output: BlockedMaterializedViewOutput;
  affordances: BrokenBindingAffordances;
  diagnostic: GlobalTemplateViewDiagnostic;
}

/** Strict JSON-safe input for the preview/runtime boundary. */
export type GlobalTemplateMaterializedView =
  | UnboundMaterializedView
  | ResolvedGlobalTemplateView
  | BlockedGlobalTemplateView;

/**
 * Small, serializable editor-facing status derived from a materialized view.
 * It deliberately carries no provider/store capability and no mutable source
 * nodes. UI callers inject lifecycle callbacks separately, so presenting a
 * linked source cannot accidentally create a second mutation route.
 */
export type LinkedEditorPresentation =
  | { state: "local" }
  | {
      state: "resolved";
      sourceRecordId: string;
      sourceName: string;
      outletId: string;
      outletLabel: string;
    }
  | {
      state: "blocked";
      sourceRecordId: string;
      message: string;
      diagnostic: GlobalTemplateViewDiagnosticCode;
    };

/** UI-only lifecycle injection point. Implementations stay provider-owned. */
export interface LinkedEditorLifecycleActions {
  onOpenSource?: (sourceRecordId: string) => void;
  onRetry?: () => void;
  /** Rendered only when a caller supplies the post-resolution lifecycle action. */
  onDetach?: () => void;
  /** Rendered only when a caller supplies the broken-binding lifecycle action. */
  onRemoveBrokenBinding?: () => void;
}

export function linkedEditorPresentation(view: GlobalTemplateMaterializedView): LinkedEditorPresentation {
  if (view.status === "local") return { state: "local" };
  if (view.status === "resolved") {
    return {
      state: "resolved",
      sourceRecordId: view.sourceRuntime.sourceRecordId,
      sourceName: view.sourceDocument.name,
      outletId: view.outlet.id,
      outletLabel: view.outlet.label,
    };
  }
  return {
    state: "blocked",
    sourceRecordId: view.diagnostic.binding.sourceRecordId,
    message: view.diagnostic.message,
    diagnostic: view.diagnostic.code,
  };
}

export type StandaloneSnapshotBlockReason =
  | "unbound"
  | "resolution-failed"
  | "invalid-materialization"
  | "id-factory-failure";

export type StandaloneSnapshotMaterialization =
  | { status: "materialized"; document: CompositionDocument }
  | {
      status: "blocked";
      reason: StandaloneSnapshotBlockReason;
      message: string;
      resolutionStatus: GlobalTemplateResolutionOutcome["status"];
    };

/** Deliberately distinct from snapshot materialization: it retains only local content. */
export interface BrokenBindingRemovalMaterialization {
  status: "removed-broken-binding";
  document: CompositionDocument;
}

interface ResolvedProjection {
  localDocument: CompositionDocument;
  sourceDocument: CompositionDocument;
  sourceRecordId: string;
  outlet: GlobalTemplateOutlet;
}

interface ProjectionFailure {
  message: string;
}

/**
 * Encode arbitrary string identities without relying on URI encoding (which
 * rejects lone surrogate code units). The result is safe to concatenate into a
 * runtime key and injective for all JavaScript strings.
 */
function identitySegment(value: string): string {
  return Array.from(value, (character) => character.codePointAt(0)!.toString(16).padStart(6, "0")).join("");
}

export function createLocalRuntimeOwner(recordId: string): Extract<MaterializedRuntimeOwner, { kind: "local" }> {
  return { kind: "local", recordId, namespace: `local:${identitySegment(recordId)}` };
}

export function createGlobalTemplateRuntimeOwner(
  sourceRecordId: string,
): Extract<MaterializedRuntimeOwner, { kind: "global-template" }> {
  return {
    kind: "global-template",
    sourceRecordId,
    namespace: `global-template:${identitySegment(sourceRecordId)}`,
  };
}

/** Stable owner-qualified identity for runtime keys, DOM attributes, and error boundaries. */
export function materializedRuntimeKey(owner: MaterializedRuntimeOwner, nodeId: string): string {
  return `${owner.namespace}:node:${identitySegment(nodeId)}`;
}

function cloneDocument(document: CompositionDocument): CompositionDocument {
  return cloneJson(document);
}

function cloneOutlet(outlet: GlobalTemplateOutlet): GlobalTemplateOutlet {
  return cloneJson(outlet);
}

function sameTarget(a: GlobalTemplateOutlet["target"], b: GlobalTemplateOutlet["target"]): boolean {
  return a.parentId === b.parentId && a.slotId === b.slotId;
}

function sameBinding(a: CompositionBinding, b: CompositionBinding): boolean {
  return a.sourceRecordId === b.sourceRecordId && a.outletId === b.outletId;
}

/** The resolver guarantees this normally; materialization rechecks stale input before replacing a slot. */
function hasEmptyOutletTarget(document: CompositionDocument, outlet: GlobalTemplateOutlet): boolean {
  let found = false;
  let empty = false;
  const visit = (nodes: readonly CompositionNode[]): void => {
    for (const node of nodes) {
      if (node.id === outlet.target.parentId) {
        found = true;
        const children = node.slots[outlet.target.slotId];
        // Missing declared slots are the model's canonical empty-slot shape;
        // the resolver treats them the same as an explicit empty array.
        empty = children === undefined || (Array.isArray(children) && children.length === 0);
      }
      for (const children of Object.values(node.slots)) visit(children);
    }
  };
  visit(document.root);
  return found && empty;
}

function materializeNodes(
  nodes: readonly CompositionNode[],
  owner: MaterializedRuntimeOwner,
  outlet: GlobalTemplateOutlet | undefined,
  localNodes: readonly CompositionNode[],
  localOwner: Extract<MaterializedRuntimeOwner, { kind: "local" }>,
  projection: { count: number },
): MaterializedViewNode[] {
  return nodes.map((node) => {
    const slots: Record<string, MaterializedViewNode[]> = {};
    const ownsOutlet = outlet !== undefined && node.id === outlet.target.parentId;
    let projectedOutlet = false;
    for (const [slotId, children] of Object.entries(node.slots)) {
      const isOutlet = ownsOutlet && slotId === outlet.target.slotId;
      if (isOutlet) {
        projectedOutlet = true;
        projection.count += 1;
        slots[slotId] = materializeNodes(localNodes, localOwner, undefined, [], localOwner, { count: 0 });
      } else {
        slots[slotId] = materializeNodes(children, owner, outlet, localNodes, localOwner, projection);
      }
    }
    if (ownsOutlet && !projectedOutlet) {
      projection.count += 1;
      slots[outlet.target.slotId] = materializeNodes(localNodes, localOwner, undefined, [], localOwner, { count: 0 });
    }
    return {
      id: node.id,
      componentId: node.componentId,
      componentVersion: node.componentVersion,
      props: cloneJson(node.props),
      slots,
      owner: { ...owner },
      runtimeKey: materializedRuntimeKey(owner, node.id),
    };
  });
}

function localView(consumer: CompositionRecord): MaterializedLocalView {
  const localDocument = cloneDocument(consumer.document);
  const localRuntime = createLocalRuntimeOwner(consumer.id);
  return {
    localDocument,
    localRuntime,
    renderRoot: materializeNodes(localDocument.root, localRuntime, undefined, [], localRuntime, { count: 0 }),
  };
}

function diagnosticMessage(status: GlobalTemplateViewDiagnosticCode): string {
  switch (status) {
    case "missing-template":
      return "The linked Global template is unavailable.";
    case "missing-outlet":
      return "The linked Global template no longer exposes this outlet.";
    case "invalid-template":
      return "The linked Global template is invalid.";
    case "nested-template":
      return "Linked Global templates cannot nest.";
    case "self-reference":
      return "A Composition cannot use itself as its Global template.";
    case "incompatible-local-root":
      return "The local root does not fit the linked Global template outlet.";
    case "invalid-materialization":
      return "The linked Global template could not be materialized safely.";
  }
}

function blockedView(
  consumer: CompositionRecord,
  binding: CompositionBinding,
  code: GlobalTemplateViewDiagnosticCode,
): BlockedGlobalTemplateView {
  const output = { preview: "blocked", export: "blocked" } as const;
  const affordances = { retry: true, detach: "remove-broken-binding" } as const;
  return {
    status: "blocked",
    ...localView(consumer),
    output,
    affordances,
    diagnostic: {
      code,
      message: diagnosticMessage(code),
      binding: cloneJson(binding),
      output,
      affordances,
    },
  };
}

/**
 * Recheck the resolved contract before projection. Normal flows receive this
 * union from the resolver, but this guard keeps manually edited/stale records
 * deterministic instead of recursing through malformed source data.
 */
function resolvedProjection(
  consumer: CompositionRecord,
  resolution: Extract<GlobalTemplateResolutionOutcome, { status: "resolved" }>,
): ResolvedProjection | ProjectionFailure {
  const binding = consumer.document.binding;
  if (!binding || !sameBinding(binding, resolution.binding)) {
    return { message: "The consumer binding no longer matches the resolved result." };
  }
  if (!isStructurallyValidDocument(consumer.document) || !isStructurallyValidDocument(resolution.source.document)) {
    return { message: "The source or consumer document is structurally invalid." };
  }
  if (resolution.source.id !== binding.sourceRecordId || resolution.source.id === consumer.id) {
    return { message: "The resolved source identity is invalid." };
  }
  if (resolution.source.document.binding) {
    return { message: "A Global template source cannot itself be bound to another template." };
  }
  const publication = resolution.source.document.publication;
  if (
    publication?.kind !== "global-template"
    || publication.outlet.id !== binding.outletId
    || publication.outlet.id !== resolution.outlet.id
    || publication.outlet.label !== resolution.outlet.label
    || !sameTarget(publication.outlet.target, resolution.outlet.target)
    || !hasEmptyOutletTarget(resolution.source.document, publication.outlet)
  ) {
    return { message: "The resolved source no longer exposes the requested outlet." };
  }
  return {
    localDocument: cloneDocument(consumer.document),
    sourceDocument: cloneDocument(resolution.source.document),
    sourceRecordId: resolution.source.id,
    outlet: cloneOutlet(publication.outlet),
  };
}

function isProjectionFailure(value: ResolvedProjection | ProjectionFailure): value is ProjectionFailure {
  return "message" in value;
}

/**
 * Materialize a strict JSON preview/view input from a canonical consumer and a
 * resolver result. A resolved result carries both clone-owned documents and a
 * transient projected tree; every other binding outcome renders local content
 * bare and blocks only linked preview/export.
 */
export function materializeGlobalTemplateView(
  consumer: CompositionRecord,
  resolution: GlobalTemplateResolutionOutcome,
): GlobalTemplateMaterializedView {
  if (resolution.status === "unbound") {
    if (consumer.document.binding) {
      return blockedView(consumer, consumer.document.binding, "invalid-materialization");
    }
    return {
      status: "local",
      ...localView(consumer),
      output: { preview: "available", export: "available" },
      affordances: { retry: false, detach: "none" },
    };
  }

  if (!consumer.document.binding) {
    return {
      status: "local",
      ...localView(consumer),
      output: { preview: "available", export: "available" },
      affordances: { retry: false, detach: "none" },
    };
  }

  if (resolution.status !== "resolved") {
    return blockedView(
      consumer,
      consumer.document.binding,
      sameBinding(consumer.document.binding, resolution.binding) ? resolution.status : "invalid-materialization",
    );
  }

  const projection = resolvedProjection(consumer, resolution);
  if (isProjectionFailure(projection)) {
    return blockedView(consumer, resolution.binding, "invalid-materialization");
  }

  const localRuntime = createLocalRuntimeOwner(consumer.id);
  const sourceRuntime = createGlobalTemplateRuntimeOwner(projection.sourceRecordId);
  const outletProjection = { count: 0 };
  const renderRoot = materializeNodes(
    projection.sourceDocument.root,
    sourceRuntime,
    projection.outlet,
    projection.localDocument.root,
    localRuntime,
    outletProjection,
  );
  if (outletProjection.count !== 1) {
    return blockedView(consumer, resolution.binding, "invalid-materialization");
  }

  return {
    status: "resolved",
    localDocument: projection.localDocument,
    localRuntime,
    sourceDocument: projection.sourceDocument,
    sourceRuntime,
    outlet: projection.outlet,
    renderRoot,
    localRootTarget: { owner: localRuntime, parentId: null, slotId: VIRTUAL_ROOT_SLOT_ID },
    output: { preview: "available", export: "available" },
    affordances: { retry: false, detach: "snapshot" },
  };
}

function collectIds(nodes: readonly CompositionNode[], ids: Set<string>): void {
  for (const node of nodes) {
    ids.add(node.id);
    for (const children of Object.values(node.slots)) collectIds(children, ids);
  }
}

function rekeySnapshotNodes(
  nodes: readonly MaterializedViewNode[],
  idFactory: IdFactory,
  inputIds: ReadonlySet<string>,
  issuedIds: Set<string>,
): CompositionNode[] {
  return nodes.map((node) => {
    const id = idFactory(node.componentId);
    if (typeof id !== "string" || id.length === 0 || inputIds.has(id) || issuedIds.has(id)) {
      throw new Error("The snapshot id factory did not produce a fresh canonical node id.");
    }
    issuedIds.add(id);
    const slots: Record<string, CompositionNode[]> = {};
    for (const [slotId, children] of Object.entries(node.slots)) {
      slots[slotId] = rekeySnapshotNodes(children, idFactory, inputIds, issuedIds);
    }
    return {
      id,
      componentId: node.componentId,
      componentVersion: node.componentVersion,
      props: cloneJson(node.props),
      slots,
    };
  });
}

/**
 * Produce the explicit detach/export result. It accepts only a currently
 * resolved binding, projects source + local content, and rekeys every node so
 * the returned v2 document is an ordinary independent Composition.
 */
export function materializeStandaloneSnapshot(
  consumer: CompositionRecord,
  resolution: GlobalTemplateResolutionOutcome,
  idFactory: IdFactory,
): StandaloneSnapshotMaterialization {
  if (resolution.status === "unbound") {
    return {
      status: "blocked",
      reason: "unbound",
      message: "An unbound Composition has no Global template snapshot to materialize.",
      resolutionStatus: resolution.status,
    };
  }
  if (resolution.status !== "resolved") {
    return {
      status: "blocked",
      reason: "resolution-failed",
      message: "A standalone snapshot requires a currently resolved Global template binding.",
      resolutionStatus: resolution.status,
    };
  }

  const view = materializeGlobalTemplateView(consumer, resolution);
  if (view.status !== "resolved") {
    return {
      status: "blocked",
      reason: "invalid-materialization",
      message: "The resolved Global template could not be projected safely.",
      resolutionStatus: resolution.status,
    };
  }

  try {
    const inputIds = new Set<string>();
    collectIds(view.localDocument.root, inputIds);
    collectIds(view.sourceDocument.root, inputIds);
    const document: CompositionDocument = {
      schemaVersion: consumer.document.schemaVersion,
      id: consumer.document.id,
      name: consumer.document.name,
      root: rekeySnapshotNodes(view.renderRoot, idFactory, inputIds, new Set<string>()),
    };
    if (!isStructurallyValidDocument(document)) {
      throw new Error("The materialized snapshot is not a valid Composition document.");
    }
    return { status: "materialized", document };
  } catch {
    return {
      status: "blocked",
      reason: "id-factory-failure",
      message: "A standalone snapshot could not be assigned fresh canonical node ids.",
      resolutionStatus: resolution.status,
    };
  }
}

/**
 * The explicit unresolved-path alternative to snapshot detach. It performs no
 * projection and deliberately retains existing local node ids, while clearing
 * all relationship metadata so callers cannot mistake it for a visual copy of
 * the missing source shell.
 */
export function materializeBrokenBindingRemoval(
  document: CompositionDocument,
): BrokenBindingRemovalMaterialization {
  return {
    status: "removed-broken-binding",
    document: {
      schemaVersion: document.schemaVersion,
      id: document.id,
      name: document.name,
      root: cloneJson(document.root),
    },
  };
}
