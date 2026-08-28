// Composer document model — JSON-safe types (wave 2, epic #243 / issue #245).
//
// The persisted `CompositionDocument` is one recursive, versioned, JSON-safe
// tree. `document.root` is a VIRTUAL insertion slot (a pseudo-row), never a
// component, persisted node, rendered wrapper, selectable/removable node, or
// JSX import. Nodes carry stable ids, a component id + schema version, JSON
// props, and a map of stable named-slot ids to child arrays.
//
// The model is pure and parameterised by a serializable manifest so it can be
// built and tested independently of the real component cohort (owned by #246).

import type {
  ComponentManifest as ContractComponentManifest,
  ComponentPackManifest,
  JsonValue,
  SlotCardinality,
} from "@zudo-composer/component-contract";
import type { RecordId } from "../../shared/record-identity";

/** A JSON object — the shape of a node's `props`. */
export type JsonObject = { [key: string]: JsonValue };

/** The only Composition document schema version this build understands. */
export const COMPOSITION_SCHEMA_VERSION = 2 as const;
export type CompositionSchemaVersion = typeof COMPOSITION_SCHEMA_VERSION;

/** A single persisted node in a Composition tree. */
export interface CompositionNode {
  /** Stable, unique node id (persisted document key). */
  id: string;
  /** Stable component id — looked up in the manifest. */
  componentId: string;
  /** Component schema version this node was authored against. */
  componentVersion: number;
  /** JSON-safe scalar props. */
  props: JsonObject;
  /** Stable slot id → ordered child nodes. */
  slots: Record<string, CompositionNode[]>;
}

/** The real component slot a Global template exposes to its consumers. */
export interface GlobalTemplateOutletTarget {
  /** Id of the component node that owns the exposed slot. Never the virtual root. */
  parentId: string;
  /** Stable manifest slot id on `parentId`. */
  slotId: string;
}

/**
 * The single named projection point a Global template exposes in schema v2.
 * `id` is machine-stable; changing the human label or target never reissues it.
 */
export interface GlobalTemplateOutlet {
  id: string;
  label: string;
  target: GlobalTemplateOutletTarget;
}

/** Publish this Composition as a live, one-outlet Global template. */
export interface GlobalTemplatePublication {
  kind: "global-template";
  outlet: GlobalTemplateOutlet;
}

/** Publish this Composition as a detached-clone Pattern. */
export interface PatternPublication {
  kind: "pattern";
}

/**
 * Reuse role persisted on a Composition. Absence means an ordinary local-only
 * Composition. The union deliberately contains no generic reference node.
 */
export type CompositionPublication = GlobalTemplatePublication | PatternPublication;

/**
 * A consumer's stable link to one source outlet. Provider identity is omitted:
 * the containing record's active provider supplies that at resolution time.
 */
export interface CompositionBinding {
  sourceRecordId: RecordId;
  outletId: string;
}

/**
 * Ephemeral constraints for the virtual consumer root.
 *
 * This deliberately contains no provider, record, or source-document data.
 * A later resolver derives the `resolved` variant from the actual exposed
 * source slot, then hands it to the same pure commands used for ordinary
 * local edits. It is never persisted in `CompositionDocument`.
 */
export type RootPolicy =
  | { kind: "unrestricted" }
  | { kind: "unresolved" }
  | {
      kind: "resolved";
      /** Omitted means the exposed slot accepts every available component. */
      accepts?: readonly string[];
      cardinality: SlotCardinality;
    };

/** A successfully resolved source/outlet contract supplied by the parent app. */
export interface ResolvedGlobalTemplateOutletContract {
  sourceRecordId: RecordId;
  outletId: string;
  /** The parent app has confirmed both records belong to its active provider. */
  sameProvider: boolean;
  /** The source is currently published as a Global template. */
  sourceIsGlobalTemplate: boolean;
  /** v1 Global templates cannot themselves consume a Global template. */
  sourceHasBinding: boolean;
  /** The actual exposed source slot, already resolved by the parent app. */
  rootPolicy: Extract<RootPolicy, { kind: "resolved" }>;
}

/** Dependency result supplied to publication-changing commands by the owner service. */
export interface PublicationDependencyGuard {
  /** Current number of canonical consumers bound to this source record. */
  dependentCount: number;
}

/** The full persisted Composition document in the current schema. */
export interface CompositionDocument {
  schemaVersion: CompositionSchemaVersion;
  id: string;
  name: string;
  /**
   * The virtual root's children. `root` is an insertion slot only — the array
   * itself is NOT a node and has no id/props/component.
   */
  root: CompositionNode[];
  /** Optional reusable-source role. Mutually exclusive with `binding` semantically. */
  publication?: CompositionPublication;
  /** Optional live source binding. The local `root` remains canonical. */
  binding?: CompositionBinding;
}

/**
 * The stable slot id used when an `InsertionTarget` addresses the virtual
 * document root (`document.root`). It is a pseudo-slot id, never a real
 * component slot.
 */
export const VIRTUAL_ROOT_SLOT_ID = "root" as const;

/**
 * A shared, discriminated insertion position reused by every downstream wave
 * (#247 controller, #248 request-add, #250 chooser capture, #251 wiring, and
 * the round-2 interaction waves). Discriminated on `parentId === null`.
 *
 * - `parentId: null` addresses the VIRTUAL ROOT; `slotId` must be
 *   `VIRTUAL_ROOT_SLOT_ID`.
 * - `parentId: string` addresses a real parent node's named slot.
 * - `index` is a strict integer in `0..length` of the target slot array
 *   (`length` = append). Validation lives in `validateInsertionTarget`.
 */
export interface InsertionTarget {
  parentId: string | null;
  slotId: string;
  index: number;
}

/**
 * The provider-independent contract definition used by model commands.
 */
export type ComponentDefinition = ContractComponentManifest;

/** Fast, read-only lookup over a set of manifest entries. */
export interface ComponentCatalog {
  get(componentId: string): ComponentDefinition | undefined;
  has(componentId: string): boolean;
  ids(): string[];
}

/** Builds a `ComponentCatalog` index from a flat list of entries. */
export function createComponentCatalog(
  source: ComponentPackManifest | readonly ComponentDefinition[],
): ComponentCatalog {
  const entries = "components" in source ? source.components : source;
  const byId = new Map<string, ComponentDefinition>();
  for (const entry of entries) byId.set(entry.id, entry);
  return {
    get: (id) => byId.get(id),
    has: (id) => byId.has(id),
    ids: () => [...byId.keys()],
  };
}
