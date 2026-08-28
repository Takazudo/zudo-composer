import { cloneForestWithNewIds } from "../model/commands";
import type { IdFactory } from "../../shared/id-factory";
import { cloneJson } from "../../shared/json";
import type { CompositionDocument, CompositionNode } from "../model/types";
import type {
  CompositionRecord,
  CompositionRecordRef,
  CompositionSummary,
} from "./types";

export interface CompositionRecordFactoryOptions {
  idFactory: IdFactory;
  now: () => string;
}

/** Wrap a document template in a fresh record without retaining references. */
export function createCompositionRecord(
  template: CompositionDocument,
  options: CompositionRecordFactoryOptions,
): CompositionRecord {
  const id = options.idFactory("composition");
  const timestamp = options.now();
  const document = cloneJson(template);
  document.id = id;
  return { id, createdAt: timestamp, updatedAt: timestamp, document };
}

export interface DuplicateCompositionRecordOptions extends CompositionRecordFactoryOptions {
  nodeIdFactory: IdFactory;
  name?: string;
}

/** Duplicate a record with no shared identity or mutable document references. */
export function duplicateCompositionRecord(
  source: CompositionRecord,
  options: DuplicateCompositionRecordOptions,
): CompositionRecord {
  const id = options.idFactory("composition");
  const timestamp = options.now();
  // A blank ordinary page is a valid record, while Pattern publication itself
  // requires roots. Keep that valid empty-page case independent of the
  // non-empty forest primitive, whose map is meaningful only when nodes exist.
  const clonedForest = source.document.root.length > 0
    ? cloneForestWithNewIds(source.document.root, options.nodeIdFactory)
    : { roots: [] as CompositionNode[], idMap: new Map<string, string>() };
  const document = {
    ...cloneJson(source.document),
    id,
    name: options.name ?? `${source.document.name} copy`,
    root: clonedForest.roots,
  };

  // Publication remains a role of the duplicate, but its outlet must point to
  // the cloned owner rather than the source document's node. Consumer bindings
  // intentionally need no rewrite: they name an external source record/outlet.
  if (document.publication?.kind === "global-template") {
    const previousOwnerId = document.publication.outlet.target.parentId;
    const clonedOwnerId = clonedForest.idMap.get(previousOwnerId);
    if (!clonedOwnerId) {
      throw new Error(`Cannot duplicate Global template with missing outlet owner "${previousOwnerId}"`);
    }
    document.publication = {
      ...document.publication,
      outlet: {
        ...document.publication.outlet,
        target: { ...document.publication.outlet.target, parentId: clonedOwnerId },
      },
    };
  }

  return {
    id,
    createdAt: timestamp,
    updatedAt: timestamp,
    document,
  };
}

/**
 * Reset an existing supported record to a template body while preserving the
 * record/document id and original creation time.
 */
export function resetCompositionRecord(
  source: CompositionRecord,
  template: CompositionDocument,
  now: () => string,
): CompositionRecord {
  const document = cloneJson(template);
  document.id = source.id;
  return {
    id: source.id,
    createdAt: source.createdAt,
    updatedAt: now(),
    document,
  };
}

function countNodes(nodes: readonly CompositionNode[]): number {
  let count = 0;
  for (const node of nodes) {
    count += 1;
    for (const children of Object.values(node.slots)) count += countNodes(children);
  }
  return count;
}

export function countCompositionNodes(document: CompositionDocument): number {
  return countNodes(document.root);
}

export function summarizeComposition(record: CompositionRecord): CompositionSummary {
  const publication = record.document.publication;
  const reuseStatus = publication === undefined
    ? undefined
    : record.document.binding !== undefined
      ? "invalid"
      : publication.kind === "pattern" && record.document.root.length === 0
        ? "empty-pattern"
        : "eligible";
  return {
    id: record.id,
    name: record.document.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    nodeCount: countCompositionNodes(record.document),
    rootCount: record.document.root.length,
    ...(publication ? { publicationKind: publication.kind } : {}),
    ...(publication?.kind === "global-template"
      ? { outletId: publication.outlet.id, outletLabel: publication.outlet.label }
      : {}),
    ...(reuseStatus ? { reuseStatus } : {}),
  };
}

/** Newest updated record first; equal timestamps use ascending id order. */
export function compareCompositionSummariesNewestFirst(
  a: Pick<CompositionSummary, "id" | "updatedAt">,
  b: Pick<CompositionSummary, "id" | "updatedAt">,
): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** Collision-free provider-qualified key for maps and route state. */
export function compositionRecordRefKey(ref: CompositionRecordRef): string {
  return JSON.stringify([ref.providerId, ref.recordId]);
}
