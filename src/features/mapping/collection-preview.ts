import type { CompositionDocument, CompositionNode } from "../../composer/model/types";
import type { MappingEvaluationResult } from "../../mapping";

/**
 * Materialize the ordered collection result for the authoring preview.
 *
 * The compiler remains the authority for delivered output. This presentation
 * projection deliberately mirrors its stable repeat identity rule so the
 * preview never mutates the canonical item Composition and a reordered query
 * produces predictable DOM identity.
 */
export function materializeCollectionPreview(
  attachmentId: string,
  fallback: CompositionDocument,
  evaluations: readonly CollectionPreviewEvaluation[],
): CompositionDocument {
  const roots = evaluations.flatMap(({ entryId, evaluation }) => {
    const document = evaluation.document;
    if (!document || evaluation.status !== "ready") return [];
    return cloneNodes(document.root, attachmentId, entryId);
  });
  return {
    ...structuredClone(fallback),
    name: `${fallback.name} · collection preview`,
    root: roots,
  };
}

export interface CollectionPreviewEvaluation {
  readonly entryId: string;
  readonly evaluation: MappingEvaluationResult;
}

function cloneNodes(nodes: readonly CompositionNode[], attachmentId: string, entryId: string): CompositionNode[] {
  return nodes.map((node) => ({
    ...structuredClone(node),
    id: repeatedNodeId(attachmentId, entryId, node.id),
    slots: Object.fromEntries(Object.entries(node.slots).map(([slotId, children]) => [slotId, cloneNodes(children, attachmentId, entryId)])),
  }));
}

function repeatedNodeId(attachmentId: string, entryId: string, nodeId: string): string {
  return `__zudo_collection_${identityPart(attachmentId)}_${identityPart(entryId)}_${identityPart(nodeId)}`;
}

function identityPart(value: string): string { return `${value.length.toString(36)}_${value}`; }
