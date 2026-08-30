// Pure Composer document history.
//
// The controller stores the entry that was current immediately BEFORE a
// document mutation. Undo therefore restores a past entry and moves the
// caller's current entry to `future`; redo performs the inverse move. The
// model deliberately has no controller, UI, or clock dependency: callers
// supply the monotonic millisecond timestamp used for typing coalescing.

import { cloneJson, type CompositionDocument } from "../../../composer/browser";

export interface ComposerHistoryEntry {
  document: CompositionDocument;
  selectedId: string | null;
}

/**
 * Identifies a coalescing group. Two consecutive pushes merge only when their
 * keys are EQUAL by the rule below. `null` means "never merge with anything".
 */
export type PropPath = readonly [prop: string, ...segments: (string | number)[]];
export type PropCoalescing = readonly PropPath[] | null;

/** Merge debounced leaf identities without ever weakening a structural null barrier. */
export function mergePropCoalescing(left: PropCoalescing, right: PropCoalescing): PropCoalescing {
  if (left === null || right === null) return null;
  const merged: PropPath[] = left.map((path) => [...path] as PropPath);
  for (const path of right) {
    if (!merged.some((candidate) => candidate.length === path.length
      && candidate.every((segment, index) => segment === path[index]))) {
      merged.push([...path] as PropPath);
    }
  }
  return merged;
}

export interface CoalesceKey {
  kind: "updateProps";
  nodeId: string;
  /** Exact edited leaves, sorted lexicographically by typed path segment. */
  propPaths: readonly PropPath[];
}

/** A past entry plus the metadata coalescing needs. Internal shape, exported for tests. */
export interface StampedEntry {
  entry: ComposerHistoryEntry;
  atMs: number;
  key: CoalesceKey | null;
}

export interface ComposerHistory {
  past: readonly StampedEntry[];
  future: readonly ComposerHistoryEntry[];
  coalescing: CoalesceKey | null;
}

/** 100 snapshots is a useful edit window while bounding document-snapshot memory. */
export const HISTORY_MAX_DEPTH = 100;

/** 1000ms sits above the 200ms inspector debounce, while a deliberate pause still creates a checkpoint. */
export const HISTORY_COALESCE_WINDOW_MS = 1000;

/** Redo ends coalescing, so the newly-restored past stamp intentionally has no group metadata. */
const NON_COALESCED_AT_MS = 0;

function snapshotEntry(entry: ComposerHistoryEntry): ComposerHistoryEntry {
  return {
    document: cloneJson(entry.document),
    selectedId: entry.selectedId,
  };
}

/** Keep the key immutable and enforce the sorted-key invariant at this seam. */
function snapshotKey(key: CoalesceKey | null): CoalesceKey | null {
  if (key === null) return null;
  return {
    kind: key.kind,
    nodeId: key.nodeId,
    propPaths: key.propPaths.map((path) => [...path] as PropPath).sort(comparePropPaths),
  };
}

function comparePathSegments(left: string | number, right: string | number): number {
  if (typeof left !== typeof right) return typeof left === "string" ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function comparePropPaths(left: PropPath, right: PropPath): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const comparison = comparePathSegments(left[index]!, right[index]!);
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
}

function samePropPath(left: PropPath, right: PropPath): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

function sameCoalesceKey(left: CoalesceKey | null, right: CoalesceKey | null): boolean {
  if (left === null || right === null) return false;
  if (left.kind !== right.kind || left.nodeId !== right.nodeId) return false;
  if (left.propPaths.length !== right.propPaths.length) return false;
  return left.propPaths.every((propPath, index) => samePropPath(propPath, right.propPaths[index]!));
}

function capPast(past: readonly StampedEntry[]): readonly StampedEntry[] {
  return past.length > HISTORY_MAX_DEPTH ? past.slice(past.length - HISTORY_MAX_DEPTH) : past;
}

export function createHistory(): ComposerHistory {
  return { past: [], future: [], coalescing: null };
}

export function pushHistory(
  history: ComposerHistory,
  entry: ComposerHistoryEntry,
  opts: { coalesceKey: CoalesceKey | null; atMs: number },
): ComposerHistory {
  const key = snapshotKey(opts.coalesceKey);
  const last = history.past[history.past.length - 1];
  const canCoalesce =
    last !== undefined &&
    key !== null &&
    history.coalescing !== null &&
    sameCoalesceKey(last.key, key) &&
    sameCoalesceKey(history.coalescing, key) &&
    opts.atMs >= last.atMs &&
    opts.atMs - last.atMs <= HISTORY_COALESCE_WINDOW_MS;

  if (canCoalesce) {
    // Preserve the first pre-burst snapshot. Only the group's trailing time
    // moves, allowing another matching push to extend this same burst.
    const nextPast = [...history.past];
    nextPast[nextPast.length - 1] = {
      entry: snapshotEntry(last.entry),
      atMs: opts.atMs,
      key: snapshotKey(last.key),
    };
    const past = capPast(nextPast);
    return { past, future: [], coalescing: snapshotKey(key) };
  }

  const past = capPast([...history.past, { entry: snapshotEntry(entry), atMs: opts.atMs, key }]);
  return {
    past,
    future: [],
    coalescing: snapshotKey(key),
  };
}

export function undoHistory(
  history: ComposerHistory,
  currentEntry: ComposerHistoryEntry,
): { history: ComposerHistory; restore: ComposerHistoryEntry } | null {
  if (history.past.length === 0) return null;

  const last = history.past[history.past.length - 1]!;
  return {
    history: {
      past: capPast(history.past.slice(0, -1)),
      future: [...history.future, snapshotEntry(currentEntry)],
      coalescing: null,
    },
    restore: snapshotEntry(last.entry),
  };
}

export function redoHistory(
  history: ComposerHistory,
  currentEntry: ComposerHistoryEntry,
): { history: ComposerHistory; restore: ComposerHistoryEntry } | null {
  if (history.future.length === 0) return null;

  const last = history.future[history.future.length - 1]!;
  const past = capPast([
    ...history.past,
    { entry: snapshotEntry(currentEntry), atMs: NON_COALESCED_AT_MS, key: null },
  ]);
  return {
    history: {
      past,
      future: history.future.slice(0, -1),
      coalescing: null,
    },
    restore: snapshotEntry(last),
  };
}

export function breakHistoryCoalescing(history: ComposerHistory): ComposerHistory {
  return { past: history.past, future: history.future, coalescing: null };
}

export function clearHistory(): ComposerHistory {
  return createHistory();
}

export function canUndo(history: ComposerHistory): boolean {
  return history.past.length > 0;
}

export function canRedo(history: ComposerHistory): boolean {
  return history.future.length > 0;
}
