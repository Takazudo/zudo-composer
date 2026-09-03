// Pure Sitemap tree commands.
//
// Commands never mutate their inputs. Expected caller mistakes are returned as
// typed values; exceptions are reserved for broken document/id-factory
// invariants. Valid no-ops retain the original document reference so consumers
// may safely memoize work on document identity.

import { cloneJson, isJsonSafe, isPlainObject, isSafeRecordId } from "../../shared";
import type { IdFactory } from "../../shared";
import { indexDocument } from "../model";
import type { SitemapDocument, SitemapNode, SitemapPageSource } from "../model";

export type SitemapCommandErrorCode =
  | "node-not-found"
  | "invalid-index"
  | "unknown-property"
  | "invalid-patch"
  | "root-cardinality"
  | "root-removal"
  | "descendant-cycle"
  | "id-collision"
  | "mapping-children";

export interface SitemapPagePropsPatch {
  title?: string;
  /** `null` removes an optional persisted property. */
  slug?: string | null;
  source?: SitemapPageSource;
  /** `null` removes an optional persisted property. */
  notes?: string | null;
}

export type SitemapCommandResult =
  | {
      ok: true;
      document: SitemapDocument;
      selectedId: string | null;
      insertedId?: string;
      idMap?: ReadonlyMap<string, string>;
      changed: boolean;
    }
  | { ok: false; error: string; code: SitemapCommandErrorCode };

export interface ClonedSitemapSubtree {
  node: SitemapNode;
  idMap: ReadonlyMap<string, string>;
}

function failure(code: SitemapCommandErrorCode, error: string): SitemapCommandResult {
  return { ok: false, code, error };
}

function validIndex(index: number, length: number): boolean {
  return Number.isInteger(index) && index >= 0 && index <= length;
}

function childrenOf(
  document: SitemapDocument,
  parentId: string | null,
  index = indexDocument(document),
): SitemapNode[] | undefined {
  if (parentId === null) return document.root;
  return index.byId.get(parentId)?.node.children;
}

function freshId(
  idFactory: IdFactory,
  hint: string,
  occupied: { has(value: string): boolean },
): string | undefined {
  const id = idFactory(hint);
  return id.length > 0 && !occupied.has(id) ? id : undefined;
}

/**
 * Create the single root page of an empty document.
 *
 * `addChildPage` needs a parent and `addSiblingPage` refuses the root list, so
 * without this an empty Sitemap could never gain its first page — which is what
 * left the canvas's "Create Home page" action with nothing to call.
 */
export function addRootPage(
  document: SitemapDocument,
  title: string,
  idFactory: IdFactory,
): SitemapCommandResult {
  if (document.root.length > 0) {
    return failure("root-cardinality", "The current Sitemap schema allows exactly one root page");
  }
  const id = freshId(idFactory, title, indexDocument(document).byId);
  if (!id) return failure("id-collision", "Id factory did not produce a fresh, non-empty page id");

  const next = cloneJson(document);
  next.root.push({ id, title, source: { kind: "unassigned" }, children: [] });
  return { ok: true, document: next, selectedId: id, insertedId: id, changed: true };
}

/** Append a fresh page to `parentId`, or insert it at an explicit child index. */
export function addChildPage(
  document: SitemapDocument,
  parentId: string,
  title: string,
  idFactory: IdFactory,
  atIndex?: number,
): SitemapCommandResult {
  const index = indexDocument(document);
  const parent = index.byId.get(parentId)?.node;
  if (!parent) return failure("node-not-found", `Parent page "${parentId}" was not found`);
  if (parent.source.kind === "mapping") return failure("mapping-children", "Mapping-source pages cannot have authored children");

  const insertionIndex = atIndex ?? parent.children.length;
  if (!validIndex(insertionIndex, parent.children.length)) {
    return failure("invalid-index", `Child index ${insertionIndex} is out of bounds`);
  }

  const id = freshId(idFactory, title, index.byId);
  if (!id) return failure("id-collision", "Id factory did not produce a fresh, non-empty page id");

  const next = cloneJson(document);
  const nextParent = indexDocument(next).byId.get(parentId)!.node;
  nextParent.children.splice(insertionIndex, 0, { id, title, source: { kind: "unassigned" }, children: [] });
  return { ok: true, document: next, selectedId: id, insertedId: id, changed: true };
}

/** Insert a fresh page beside `pageId` (immediately after it by default). */
export function addSiblingPage(
  document: SitemapDocument,
  pageId: string,
  title: string,
  idFactory: IdFactory,
  atIndex?: number,
): SitemapCommandResult {
  const index = indexDocument(document);
  const location = index.byId.get(pageId);
  if (!location) return failure("node-not-found", `Page "${pageId}" was not found`);
  if (location.parentId === null) {
    return failure("root-cardinality", "The current Sitemap schema allows exactly one root page");
  }

  const siblings = childrenOf(document, location.parentId, index)!;
  const insertionIndex = atIndex ?? location.index + 1;
  if (!validIndex(insertionIndex, siblings.length)) {
    return failure("invalid-index", `Sibling index ${insertionIndex} is out of bounds`);
  }

  const id = freshId(idFactory, title, index.byId);
  if (!id) return failure("id-collision", "Id factory did not produce a fresh, non-empty page id");

  const next = cloneJson(document);
  const nextSiblings = childrenOf(next, location.parentId)!;
  nextSiblings.splice(insertionIndex, 0, { id, title, source: { kind: "unassigned" }, children: [] });
  return { ok: true, document: next, selectedId: id, insertedId: id, changed: true };
}

const PAGE_PROP_KEYS = new Set(["title", "slug", "source", "notes"]);

function validRef(value: unknown): boolean {
  return isPlainObject(value)
    && Object.keys(value).length === 2
    && Object.hasOwn(value, "providerId")
    && Object.hasOwn(value, "recordId")
    && typeof value.providerId === "string"
    && value.providerId.length > 0
    && isSafeRecordId(value.recordId);
}

function validSource(value: unknown): value is SitemapPageSource {
  if (!isPlainObject(value) || typeof value.kind !== "string") return false;
  if (value.kind === "unassigned") return Object.keys(value).length === 1;
  if (value.kind === "composition") return Object.keys(value).length === 2 && validRef(value.ref);
  if (value.kind !== "mapping" || Object.keys(value).length !== 3 || !validRef(value.ref) || !isPlainObject(value.route)) return false;
  return value.route.kind === "single"
    ? Object.keys(value.route).length === 1
    : value.route.kind === "entry-field"
      && (Object.keys(value.route).length === 2 || Object.keys(value.route).length === 3)
      && Object.keys(value.route).every((key) => key === "kind" || key === "fieldId" || key === "titleFieldId")
      && isSafeRecordId(value.route.fieldId)
      && (!Object.hasOwn(value.route, "titleFieldId") || isSafeRecordId(value.route.titleFieldId));
}

function equalSource(a: unknown, b: SitemapPageSource): boolean {
  if (!validSource(a) || a.kind !== b.kind) return false;
  if (a.kind === "unassigned" || b.kind === "unassigned") return a.kind === b.kind;
  if (a.ref.providerId !== b.ref.providerId || a.ref.recordId !== b.ref.recordId) return false;
  if (a.kind === "composition" || b.kind === "composition") return a.kind === b.kind;
  return a.route.kind === b.route.kind && (a.route.kind === "single" || (b.route.kind === "entry-field" && a.route.fieldId === b.route.fieldId && a.route.titleFieldId === b.route.titleFieldId));
}

function validPatchValue(key: string, value: unknown): boolean {
  if (key === "title") return typeof value === "string";
  if (key === "slug" || key === "notes") return value === null || typeof value === "string";
  if (key === "source") return validSource(value);
  return false;
}

/** Merge a JSON-safe page-property patch; `null` removes optional properties. */
export function updatePageProps(
  document: SitemapDocument,
  pageId: string,
  patch: SitemapPagePropsPatch,
): SitemapCommandResult {
  const location = indexDocument(document).byId.get(pageId);
  const requestedSource = patch.source;
  if (!location) return failure("node-not-found", `Page "${pageId}" was not found`);
  if (!isPlainObject(patch) || !isJsonSafe(patch)) {
    return failure("invalid-patch", "Page property patch must be a JSON-safe object");
  }

  for (const [key, value] of Object.entries(patch)) {
    if (!PAGE_PROP_KEYS.has(key)) {
      return failure("unknown-property", `Unknown page property "${key}"`);
    }
    if (!validPatchValue(key, value)) {
      return failure("invalid-patch", `Invalid value for page property "${key}"`);
    }
  }

  const current = location.node as SitemapNode & Record<string, unknown>;
  const changed = Object.entries(patch).some(([key, value]) => {
    if (value === null) return Object.hasOwn(current, key);
    if (key === "source" && validSource(value)) return !equalSource(current[key], value);
    return current[key] !== value;
  });
  if (!changed) {
    return { ok: true, document, selectedId: pageId, changed: false };
  }

  if (requestedSource?.kind === "mapping" && location.node.children.length > 0) {
    return failure("mapping-children", "Move or remove authored children before assigning a Mapping");
  }

  const next = cloneJson(document);
  const node = indexDocument(next).byId.get(pageId)!.node as SitemapNode & Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete node[key];
    else node[key] = cloneJson(value as object | string) as unknown;
  }
  return { ok: true, document: next, selectedId: pageId, changed: true };
}

/** Rename one page; an identical title is a valid no-op. */
export function renamePage(
  document: SitemapDocument,
  pageId: string,
  title: string,
): SitemapCommandResult {
  return updatePageProps(document, pageId, { title });
}

function subtreeIds(node: SitemapNode, ids = new Set<string>()): Set<string> {
  ids.add(node.id);
  for (const child of node.children) subtreeIds(child, ids);
  return ids;
}

/**
 * Remove a non-root page and repair selection to the next sibling, previous
 * sibling, parent, or null in that order. A surviving selection is retained.
 */
export function removePage(
  document: SitemapDocument,
  pageId: string,
  selectedId: string | null = null,
): SitemapCommandResult {
  const index = indexDocument(document);
  const location = index.byId.get(pageId);
  if (!location) return failure("node-not-found", `Page "${pageId}" was not found`);
  if (location.parentId === null) {
    return failure("root-removal", "The single root page cannot be removed");
  }

  const removedIds = subtreeIds(location.node);
  const next = cloneJson(document);
  const siblings = childrenOf(next, location.parentId)!;
  siblings.splice(location.index, 1);

  let repaired = selectedId;
  if (selectedId === null || removedIds.has(selectedId) || !index.byId.has(selectedId)) {
    repaired = siblings[location.index]?.id
      ?? siblings[location.index - 1]?.id
      ?? location.parentId;
  }
  return { ok: true, document: next, selectedId: repaired, changed: true };
}

/**
 * Deep-clone a detached subtree, re-issuing every id and returning the complete
 * old-to-new mapping. All other persisted values, including source refs,
 * are copied verbatim.
 */
export function cloneSubtreeWithNewIds(
  source: SitemapNode,
  idFactory: IdFactory,
): ClonedSitemapSubtree {
  const sourceIds = new Set<string>();
  const collectSourceIds = (node: SitemapNode): void => {
    if (sourceIds.has(node.id)) {
      throw new Error(`Cannot clone a subtree with duplicate source page id "${node.id}"`);
    }
    sourceIds.add(node.id);
    for (const child of node.children) collectSourceIds(child);
  };
  collectSourceIds(source);
  const generated = new Set<string>();
  const idMap = new Map<string, string>();
  const detached = cloneJson(source);

  const reissue = (node: SitemapNode): SitemapNode => {
    const id = idFactory(node.title);
    if (id.length === 0 || sourceIds.has(id) || generated.has(id)) {
      throw new Error(`Id factory produced a non-fresh page id "${id}"`);
    }
    generated.add(id);
    idMap.set(node.id, id);
    return { ...node, id, children: node.children.map(reissue) };
  };

  return { node: reissue(detached), idMap };
}

/** Duplicate a page subtree immediately after its source. */
export function duplicatePage(
  document: SitemapDocument,
  pageId: string,
  idFactory: IdFactory,
): SitemapCommandResult {
  const index = indexDocument(document);
  const location = index.byId.get(pageId);
  if (!location) return failure("node-not-found", `Page "${pageId}" was not found`);
  if (location.parentId === null) {
    return failure("root-cardinality", "The current Sitemap schema allows exactly one root page");
  }

  let cloned: ClonedSitemapSubtree;
  try {
    cloned = cloneSubtreeWithNewIds(location.node, idFactory);
  } catch (error) {
    return failure(
      "id-collision",
      error instanceof Error ? error.message : "Could not create fresh page ids",
    );
  }
  for (const id of cloned.idMap.values()) {
    if (index.byId.has(id)) {
      return failure("id-collision", `Page id "${id}" already exists in the document`);
    }
  }

  const next = cloneJson(document);
  const siblings = childrenOf(next, location.parentId)!;
  siblings.splice(location.index + 1, 0, cloned.node);
  return {
    ok: true,
    document: next,
    selectedId: cloned.node.id,
    insertedId: cloned.node.id,
    idMap: cloned.idMap,
    changed: true,
  };
}

/**
 * Move a subtree to `targetParentId` at an index measured before source
 * removal. Moving into the source subtree is rejected; a later same-list index
 * is decremented after detach.
 */
export function movePage(
  document: SitemapDocument,
  pageId: string,
  targetParentId: string | null,
  targetIndex: number,
): SitemapCommandResult {
  const index = indexDocument(document);
  const source = index.byId.get(pageId);
  if (!source) return failure("node-not-found", `Page "${pageId}" was not found`);

  if (targetParentId !== null && subtreeIds(source.node).has(targetParentId)) {
    return failure("descendant-cycle", `Cannot move "${pageId}" into its own subtree`);
  }
  const target = childrenOf(document, targetParentId, index);
  if (!target) return failure("node-not-found", `Target parent page "${targetParentId}" was not found`);
  if (targetParentId !== null && index.byId.get(targetParentId)?.node.source.kind === "mapping") {
    return failure("mapping-children", "Mapping-source pages cannot have authored children");
  }
  if (!validIndex(targetIndex, target.length)) {
    return failure("invalid-index", `Target index ${targetIndex} is out of bounds`);
  }

  const sameList = source.parentId === targetParentId;
  if (!sameList && targetParentId === null) {
    return failure("root-cardinality", "Sitemap v1 allows exactly one root page");
  }
  const insertionIndex = sameList && source.index < targetIndex ? targetIndex - 1 : targetIndex;
  if (sameList && insertionIndex === source.index) {
    return { ok: true, document, selectedId: pageId, changed: false };
  }

  const next = cloneJson(document);
  const nextIndex = indexDocument(next);
  const sourceList = childrenOf(next, source.parentId, nextIndex)!;
  const [detached] = sourceList.splice(source.index, 1);
  const targetList = childrenOf(next, targetParentId, nextIndex)!;
  targetList.splice(insertionIndex, 0, detached!);
  return { ok: true, document: next, selectedId: pageId, changed: true };
}

/** Swap a page with its previous or next sibling; boundaries are no-ops. */
export function reorderPage(
  document: SitemapDocument,
  pageId: string,
  direction: "up" | "down",
): SitemapCommandResult {
  const index = indexDocument(document);
  const location = index.byId.get(pageId);
  if (!location) return failure("node-not-found", `Page "${pageId}" was not found`);
  const siblings = childrenOf(document, location.parentId, index)!;
  const targetIndex = direction === "up" ? location.index - 1 : location.index + 1;
  if (targetIndex < 0 || targetIndex >= siblings.length) {
    return { ok: true, document, selectedId: pageId, changed: false };
  }

  const next = cloneJson(document);
  const nextSiblings = childrenOf(next, location.parentId)!;
  [nextSiblings[location.index], nextSiblings[targetIndex]] = [
    nextSiblings[targetIndex]!,
    nextSiblings[location.index]!,
  ];
  return { ok: true, document: next, selectedId: pageId, changed: true };
}
