// The publish/render seam between a route and the application chrome.
//
// A route knows its own breadcrumb trail and save state; the Shell knows where
// to draw them. Putting the contract here means neither imports the other: the
// Shell reads `chromeSnapshot()`, a route calls `bindBreadcrumb()` /
// `bindEditorStatus()` with the `ChromeStore` it was handed (`services.chrome`),
// and an editor surface can publish its status without ever importing chrome.
//
// The store is deliberately equality-guarded. Routes republish a computed
// trail whenever any of its inputs change, and an unguarded store would notify
// the Shell for every unchanged value. `onRetry` is republished through one
// stable wrapper for the same reason: the Shell's snapshot must never hold a
// stale closure, and a new closure identity must not count as a status change.
//
// This module is JSX-free so it can be imported from `.ts` route models.

import type { ReadonlySignal, Scope } from "@takazudo/zfb/zudo-react";
import { storeSignal } from "../runtime";
import { read, type MaybeSignal } from "../components/reactive";

export interface BreadcrumbItem {
  readonly label: string;
  /** Omitted for the trailing, current-location crumb. */
  readonly href?: string;
}

export type EditorStatusState = "saved" | "unsaved" | "saving" | "failed";

export interface EditorStatus {
  readonly state: EditorStatusState;
  /** Short human explanation, typically the failure reason. */
  readonly detail?: string;
  /** Present only when the chrome should offer a retry affordance. */
  readonly onRetry?: () => void;
}

export interface ChromeSnapshot {
  readonly breadcrumb: readonly BreadcrumbItem[];
  readonly editorStatus: EditorStatus | null;
}

/** Identity of one publishing component, so a stale unmount cannot clear a newer publish. */
export type ChromeOwner = object;

export interface ChromeStore {
  getSnapshot(): ChromeSnapshot;
  subscribe(listener: (snapshot: ChromeSnapshot) => void): () => void;
  publishBreadcrumb(owner: ChromeOwner, items: readonly BreadcrumbItem[]): void;
  releaseBreadcrumb(owner: ChromeOwner): void;
  publishEditorStatus(owner: ChromeOwner, status: EditorStatus | null): void;
  releaseEditorStatus(owner: ChromeOwner): void;
}

const EMPTY_BREADCRUMB: readonly BreadcrumbItem[] = Object.freeze([]);

/** The state the chrome renders before any route has published. */
export const EMPTY_CHROME_SNAPSHOT: ChromeSnapshot = Object.freeze({
  breadcrumb: EMPTY_BREADCRUMB,
  editorStatus: null,
});

function sameBreadcrumb(current: readonly BreadcrumbItem[], next: readonly BreadcrumbItem[]): boolean {
  return current.length === next.length
    && current.every((item, index) => item.label === next[index]!.label && item.href === next[index]!.href);
}

function sameEditorStatus(current: EditorStatus | null, next: EditorStatus | null): boolean {
  if (current === null || next === null) return current === next;
  return current.state === next.state
    && current.detail === next.detail
    && (current.onRetry === undefined) === (next.onRetry === undefined);
}

export function createChromeStore(): ChromeStore {
  const listeners = new Set<(snapshot: ChromeSnapshot) => void>();
  let snapshot: ChromeSnapshot = EMPTY_CHROME_SNAPSHOT;
  let breadcrumbOwner: ChromeOwner | null = null;
  let statusOwner: ChromeOwner | null = null;
  let retry: (() => void) | undefined;

  /** One stable identity for every published retry, resolving to the newest callback. */
  const invokeRetry = (): void => { retry?.(); };

  const commit = (next: ChromeSnapshot): void => {
    if (sameBreadcrumb(snapshot.breadcrumb, next.breadcrumb) && sameEditorStatus(snapshot.editorStatus, next.editorStatus)) return;
    snapshot = next;
    for (const listener of [...listeners]) listener(snapshot);
  };

  const withBreadcrumb = (breadcrumb: readonly BreadcrumbItem[]): ChromeSnapshot => ({ breadcrumb, editorStatus: snapshot.editorStatus });
  const withEditorStatus = (editorStatus: EditorStatus | null): ChromeSnapshot => ({ breadcrumb: snapshot.breadcrumb, editorStatus });

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    publishBreadcrumb(owner, items) {
      breadcrumbOwner = owner;
      commit(withBreadcrumb(items.map((item) => (item.href === undefined ? { label: item.label } : { label: item.label, href: item.href }))));
    },
    releaseBreadcrumb(owner) {
      if (breadcrumbOwner !== owner) return;
      breadcrumbOwner = null;
      commit(withBreadcrumb(EMPTY_BREADCRUMB));
    },
    publishEditorStatus(owner, status) {
      statusOwner = owner;
      retry = status?.onRetry;
      commit(withEditorStatus(status === null ? null : {
        state: status.state,
        ...(status.detail === undefined ? {} : { detail: status.detail }),
        ...(status.onRetry === undefined ? {} : { onRetry: invokeRetry }),
      }));
    },
    releaseEditorStatus(owner) {
      if (statusOwner !== owner) return;
      statusOwner = null;
      retry = undefined;
      commit(withEditorStatus(null));
    },
  };
}

/**
 * The currently published chrome state, owned by `scope`. The Shell is the only
 * expected caller; a `null` store (a route rendered without chrome) reads empty.
 */
export function chromeSnapshot(scope: Scope, store: ChromeStore | null): ReadonlySignal<ChromeSnapshot> {
  return storeSignal(scope, store ?? { getSnapshot: () => EMPTY_CHROME_SNAPSHOT, subscribe: () => () => {} });
}

/**
 * Publish this scope's breadcrumb trail. A signal trail republishes whenever it
 * changes; the store drops an unchanged publish. The trail is released when
 * `scope` is disposed, and a `null` store keeps the route silent.
 */
export function bindBreadcrumb(scope: Scope, store: ChromeStore | null, items: MaybeSignal<readonly BreadcrumbItem[]>): void {
  if (!store) return;
  const owner: ChromeOwner = {};
  scope.effect(() => {
    store.publishBreadcrumb(owner, read(items));
  });
  scope.onCleanup(() => store.releaseBreadcrumb(owner));
}

/** Publish this editor's save state; `null` withdraws it without disposing the scope. */
export function bindEditorStatus(scope: Scope, store: ChromeStore | null, status: MaybeSignal<EditorStatus | null>): void {
  if (!store) return;
  const owner: ChromeOwner = {};
  scope.effect(() => {
    store.publishEditorStatus(owner, read(status));
  });
  scope.onCleanup(() => store.releaseEditorStatus(owner));
}
