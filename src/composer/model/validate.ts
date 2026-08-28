// Load/validate + per-node diagnostics for the Composition model.
//
// Two independent layers:
//  1. STRUCTURAL validity (`isStructurallyValidDocument`) — manifest-agnostic.
//     Answers "is this a well-formed CompositionDocument?" (schema version,
//     shape, JSON-safe props, unique ids, no cycles). Recovery uses this to
//     decide malformed-vs-loadable. A document that merely references an
//     unknown component is STILL structurally valid — it loads and its unknown
//     nodes become opaque placeholders.
//  2. SEMANTIC diagnostics (`diagnoseDocument`) — checked against a manifest.
//     Classifies opaque/unavailable nodes (unknown component, unsupported
//     version, removed slot, cardinality/accepts violations) and decides
//     whether JSX export is safe.

import type {
  ComponentCatalog,
  CompositionBinding,
  CompositionDocument,
  CompositionNode,
  CompositionPublication,
  GlobalTemplateOutlet,
  InsertionTarget,
  RootPolicy,
} from "./types";
import { COMPOSITION_SCHEMA_VERSION, VIRTUAL_ROOT_SLOT_ID } from "./types";
import { isJsonSafe, isPlainObject } from "../../shared/json";
import { orderedSlotIds } from "./index-model";
import { isSafeRecordId } from "../../shared/record-identity";

// ── Structural validation (manifest-agnostic) ───────────────────────────────

function hasOnlyKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function isValidNodeShape(
  value: unknown,
  seenIds: Set<string>,
  seenRefs: Set<object>,
): boolean {
  if (!isPlainObject(value)) return false;
  if (seenRefs.has(value)) return false; // structural cycle via shared ref
  seenRefs.add(value);

  const node = value as Record<string, unknown>;
  if (!hasOnlyKeys(node, ["id", "componentId", "componentVersion", "props", "slots"])) return false;
  if (typeof node.id !== "string" || node.id.length === 0) return false;
  if (seenIds.has(node.id)) return false; // duplicate id
  seenIds.add(node.id);
  if (typeof node.componentId !== "string" || node.componentId.length === 0) return false;
  if (
    typeof node.componentVersion !== "number"
    || !Number.isInteger(node.componentVersion)
    || node.componentVersion <= 0
  ) {
    return false;
  }
  if (!isPlainObject(node.props) || !isJsonSafe(node.props)) return false;
  if (!isPlainObject(node.slots)) return false;

  for (const children of Object.values(node.slots as Record<string, unknown>)) {
    if (!Array.isArray(children)) return false;
    for (const child of children) {
      if (!isValidNodeShape(child, seenIds, seenRefs)) return false;
    }
  }
  return true;
}

function isValidOutletTarget(value: unknown): boolean {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["parentId", "slotId"])) return false;
  return typeof value.parentId === "string" && value.parentId.length > 0
    && typeof value.slotId === "string" && value.slotId.length > 0;
}

function isValidOutlet(value: unknown): value is GlobalTemplateOutlet {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["id", "label", "target"])) return false;
  return typeof value.id === "string" && value.id.length > 0
    && typeof value.label === "string"
    && isValidOutletTarget(value.target);
}

function isValidPublication(value: unknown): value is CompositionPublication {
  if (!isPlainObject(value) || typeof value.kind !== "string") return false;
  if (value.kind === "global-template") {
    return hasOnlyKeys(value, ["kind", "outlet"]) && isValidOutlet(value.outlet);
  }
  return value.kind === "pattern" && hasOnlyKeys(value, ["kind"]);
}

function isValidBinding(value: unknown): value is CompositionBinding {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["sourceRecordId", "outletId"])) return false;
  return isSafeRecordId(value.sourceRecordId)
    && typeof value.outletId === "string"
    && value.outletId.length > 0;
}

/**
 * True when `value` is a well-formed `CompositionDocument` of the SUPPORTED
 * schema version: correct shape, JSON-safe props, globally unique node ids, and
 * no structural cycles. Unknown component ids do NOT fail this check.
 */
export function isStructurallyValidDocument(value: unknown): value is CompositionDocument {
  if (!isPlainObject(value)) return false;
  const doc = value as Record<string, unknown>;
  if (!hasOnlyKeys(doc, ["schemaVersion", "id", "name", "root"], ["publication", "binding"])) {
    return false;
  }
  if (doc.schemaVersion !== COMPOSITION_SCHEMA_VERSION) return false;
  if (typeof doc.id !== "string" || doc.id.length === 0 || typeof doc.name !== "string") return false;
  if (!Array.isArray(doc.root)) return false;
  if (Object.hasOwn(doc, "publication") && !isValidPublication(doc.publication)) return false;
  if (Object.hasOwn(doc, "binding") && !isValidBinding(doc.binding)) return false;

  const seenIds = new Set<string>();
  const seenRefs = new Set<object>();
  for (const node of doc.root) {
    if (!isValidNodeShape(node, seenIds, seenRefs)) return false;
  }
  return true;
}

// ── Semantic diagnostics (manifest-aware) ───────────────────────────────────

export type DiagnosticCode =
  | "unknown-component"
  | "unsupported-version"
  | "removed-slot"
  | "cardinality-violation"
  | "unaccepted-child";

/** Reuse-role diagnostics that preserve structurally valid local content. */
export type ReuseDiagnosticCode =
  | "publication-binding-conflict"
  | "self-binding"
  | "empty-pattern-root"
  | "stale-outlet-target";

export interface DiagnosticReason {
  code: DiagnosticCode;
  message: string;
  /** Slot the reason concerns, when applicable. */
  slotId?: string;
}

export interface NodeDiagnostic {
  nodeId: string;
  componentId: string;
  /** True when the node is unavailable and must render as an opaque placeholder. */
  opaque: boolean;
  reasons: DiagnosticReason[];
}

export interface ReuseDiagnosticReason {
  code: ReuseDiagnosticCode;
  message: string;
}

export interface DiagnoseDocumentOptions {
  /**
   * The containing record's id, when it differs from the document id in a
   * caller's temporary model. Omitted values use `document.id`.
   */
  containingRecordId?: string;
}

export interface DocumentDiagnostics {
  byId: Map<string, NodeDiagnostic>;
  /** Ids of all opaque nodes, in traversal order. */
  opaqueIds: string[];
  hasOpaque: boolean;
  /** False when any opaque node exists — JSX export must be refused. */
  canExport: boolean;
  /** Semantic reuse diagnostics; they never mutate or sample-recover the document. */
  reuseReasons: ReuseDiagnosticReason[];
  hasReuseIssues: boolean;
}

/** Classify a single node against the manifest. Pure; ignores children. */
export function classifyNode(
  node: CompositionNode,
  manifest: ComponentCatalog,
): NodeDiagnostic {
  const reasons: DiagnosticReason[] = [];
  const entry = manifest.get(node.componentId);

  if (!entry) {
    reasons.push({
      code: "unknown-component",
      message: `Unknown component "${node.componentId}" — not in the manifest`,
    });
    return { nodeId: node.id, componentId: node.componentId, opaque: true, reasons };
  }

  if (node.componentVersion !== entry.schemaVersion) {
    reasons.push({
      code: "unsupported-version",
      message: `Node uses "${node.componentId}" v${node.componentVersion}, but the manifest provides v${entry.schemaVersion}`,
    });
  }

  const declaredIds = new Set(entry.slots.map((s) => s.id));
  for (const slotId of Object.keys(node.slots)) {
    if (!declaredIds.has(slotId)) {
      reasons.push({
        code: "removed-slot",
        message: `Slot "${slotId}" is no longer declared on "${node.componentId}"`,
        slotId,
      });
    }
  }

  for (const slot of entry.slots) {
    const children = node.slots[slot.id] ?? [];
    if (slot.cardinality === "single" && children.length > 1) {
      reasons.push({
        code: "cardinality-violation",
        message: `Slot "${slot.id}" is single but holds ${children.length} children`,
        slotId: slot.id,
      });
    }
    if (slot.accepts) {
      const allowed = new Set(slot.accepts);
      for (const child of children) {
        if (!allowed.has(child.componentId)) {
          reasons.push({
            code: "unaccepted-child",
            message: `Slot "${slot.id}" does not accept "${child.componentId}"`,
            slotId: slot.id,
          });
        }
      }
    }
  }

  return {
    nodeId: node.id,
    componentId: node.componentId,
    opaque: reasons.length > 0,
    reasons,
  };
}

/**
 * Classify every node in the document. `canExport` is false when any node is
 * opaque — the JSX generator uses it to refuse a misleading export rather than
 * silently dropping preserved data.
 */
export function diagnoseDocument(
  document: CompositionDocument,
  manifest: ComponentCatalog,
  options: DiagnoseDocumentOptions = {},
): DocumentDiagnostics {
  const byId = new Map<string, NodeDiagnostic>();
  const nodesById = new Map<string, CompositionNode>();
  const opaqueIds: string[] = [];

  const walk = (children: CompositionNode[]): void => {
    for (const node of children) {
      const diagnostic = classifyNode(node, manifest);
      byId.set(node.id, diagnostic);
      nodesById.set(node.id, node);
      if (diagnostic.opaque) opaqueIds.push(node.id);
      const entry = manifest.get(node.componentId);
      for (const slotId of orderedSlotIds(node, entry)) {
        walk(node.slots[slotId] ?? []);
      }
    }
  };
  walk(document.root);

  const reuseReasons: ReuseDiagnosticReason[] = [];
  const containingRecordId = options.containingRecordId ?? document.id;
  if (document.publication && document.binding) {
    reuseReasons.push({
      code: "publication-binding-conflict",
      message: "A Composition cannot be both a reusable source and a live consumer binding.",
    });
  }
  if (
    document.binding
    && document.binding.sourceRecordId === containingRecordId
  ) {
    reuseReasons.push({
      code: "self-binding",
      message: "A Composition cannot bind to itself as its Global template source.",
    });
  }
  if (document.publication?.kind === "pattern" && document.root.length === 0) {
    reuseReasons.push({
      code: "empty-pattern-root",
      message: "A Pattern must retain at least one root component before it can be offered for insertion.",
    });
  }
  if (document.publication?.kind === "global-template") {
    const { parentId, slotId } = document.publication.outlet.target;
    const parent = nodesById.get(parentId);
    const entry = parent ? manifest.get(parent.componentId) : undefined;
    const targetDeclared = entry?.slots.some((slot) => slot.id === slotId) ?? false;
    const targetChildren = parent?.slots[slotId];
    if (!parent || !targetDeclared || (targetChildren !== undefined && targetChildren.length > 0)) {
      reuseReasons.push({
        code: "stale-outlet-target",
        message: `Global template outlet target "${parentId}/${slotId}" is no longer a declared empty component slot.`,
      });
    }
  }

  return {
    byId,
    opaqueIds,
    hasOpaque: opaqueIds.length > 0,
    canExport: opaqueIds.length === 0,
    reuseReasons,
    hasReuseIssues: reuseReasons.length > 0,
  };
}

/** True when the given node is editable (known component, matching version). */
export function isNodeOpaque(node: CompositionNode, manifest: ComponentCatalog): boolean {
  return classifyNode(node, manifest).opaque;
}

// ── Insertion-target validation ─────────────────────────────────────────────

export interface TargetValidation {
  ok: boolean;
  /** Present when `ok` is false. */
  error?: string;
}

/** Root policy for ordinary, unbound Composition documents. */
export const UNRESTRICTED_ROOT_POLICY: Extract<RootPolicy, { kind: "unrestricted" }> = {
  kind: "unrestricted",
};

/** Root policy used until a bound consumer's source/outlet is resolved. */
export const UNRESOLVED_ROOT_POLICY: Extract<RootPolicy, { kind: "unresolved" }> = {
  kind: "unresolved",
};

/**
 * Choose the only safe effective policy for a document mutation.
 *
 * Unbound documents always use their ordinary unrestricted virtual root. A
 * bound document may use only a resolver-supplied resolved policy; a missing
 * (or accidentally unrestricted) context is intentionally treated as unknown
 * so a direct model caller cannot bypass the source outlet's constraints.
 */
export function effectiveRootPolicy(
  document: CompositionDocument,
  supplied?: RootPolicy,
): RootPolicy {
  if (!document.binding) return UNRESTRICTED_ROOT_POLICY;
  return supplied?.kind === "resolved" ? supplied : UNRESOLVED_ROOT_POLICY;
}

/** Validate an existing consumer-root forest against a resolved source outlet. */
export function validateRootForest(
  roots: readonly CompositionNode[],
  policy: RootPolicy,
): TargetValidation {
  if (policy.kind === "unrestricted") return { ok: true };
  if (policy.kind === "unresolved") {
    return {
      ok: false,
      error: "Cannot insert at the consumer root until its Global template outlet is resolved",
    };
  }

  if (policy.cardinality === "single" && roots.length > 1) {
    return {
      ok: false,
      error: "The bound Global template outlet accepts only one root component",
    };
  }
  if (policy.accepts) {
    for (const root of roots) {
      if (!policy.accepts.includes(root.componentId)) {
        return {
          ok: false,
          error: `The bound Global template outlet does not accept "${root.componentId}" at the consumer root`,
        };
      }
    }
  }
  return { ok: true };
}

/** Validate one new component entering a virtual root under its effective policy. */
export function validateRootInsertion(
  existingRootCount: number,
  componentId: string,
  policy: RootPolicy,
): TargetValidation {
  if (policy.kind === "unrestricted") return { ok: true };
  if (policy.kind === "unresolved") {
    return {
      ok: false,
      error: "Cannot insert at the consumer root until its Global template outlet is resolved",
    };
  }
  if (policy.cardinality === "single" && existingRootCount >= 1) {
    return {
      ok: false,
      error: "The bound Global template outlet accepts only one root component",
    };
  }
  if (policy.accepts && !policy.accepts.includes(componentId)) {
    return {
      ok: false,
      error: `The bound Global template outlet does not accept "${componentId}" at the consumer root`,
    };
  }
  return { ok: true };
}

/** True when a named slot is reserved for the live consumer projection. */
export function isPublishedOutletTarget(
  document: CompositionDocument,
  parentId: string | null,
  slotId: string,
): boolean {
  const outlet = document.publication?.kind === "global-template"
    ? document.publication.outlet.target
    : undefined;
  return outlet !== undefined && parentId === outlet.parentId && slotId === outlet.slotId;
}

/**
 * Validates an `InsertionTarget` against the document + manifest: the parent
 * must exist (or be the virtual root), the slot must be declared on the parent,
 * the parent must not be opaque, and `index` must be a strict integer in
 * `0..length` of the target slot array (`length` = append).
 */
export function validateInsertionTarget(
  document: CompositionDocument,
  manifest: ComponentCatalog,
  target: InsertionTarget,
  locate: (id: string) => CompositionNode | undefined,
): TargetValidation {
  const { parentId, slotId, index } = target;

  if (isPublishedOutletTarget(document, parentId, slotId)) {
    return {
      ok: false,
      error: "This Global template outlet is reserved for its consumers and cannot receive local children",
    };
  }

  let slotChildren: CompositionNode[];

  if (parentId === null) {
    if (slotId !== VIRTUAL_ROOT_SLOT_ID) {
      return { ok: false, error: `Virtual-root insertion must use slot "${VIRTUAL_ROOT_SLOT_ID}"` };
    }
    slotChildren = document.root;
  } else {
    const parent = locate(parentId);
    if (!parent) return { ok: false, error: `Parent node "${parentId}" not found` };
    const entry = manifest.get(parent.componentId);
    if (!entry) {
      return { ok: false, error: `Cannot add into opaque node "${parentId}" (unknown component)` };
    }
    if (isNodeOpaque(parent, manifest)) {
      return { ok: false, error: `Cannot add into opaque node "${parentId}"` };
    }
    const slot = entry.slots.find((s) => s.id === slotId);
    if (!slot) {
      return { ok: false, error: `Slot "${slotId}" is not declared on "${parent.componentId}"` };
    }
    slotChildren = parent.slots[slotId] ?? [];
  }

  if (!Number.isInteger(index) || index < 0 || index > slotChildren.length) {
    return {
      ok: false,
      error: `Insertion index ${index} out of range 0..${slotChildren.length}`,
    };
  }

  return { ok: true };
}
