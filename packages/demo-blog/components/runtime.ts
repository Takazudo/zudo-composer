import { getScope, signal, type ReadonlySignal } from "@takazudo/zfb/zudo-react";

/** Last non-empty path segment of the current page; "" outside a browser. */
export function currentRouteSegment(): string {
  const path = typeof location === "undefined" ? "" : location.pathname;
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "";
}

export function currentPathname(): string {
  return typeof location === "undefined" ? "" : location.pathname;
}

/** Nav rule from the spec: an item is current when its href prefixes the path. */
export function isCurrentHref(href: string, pathname: string): boolean {
  if (!href || !pathname) return false;
  const base = href.length > 1 ? href.replace(/\/+$/, "") : href;
  if (base === "/") return pathname === "/";
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * List hosts (article lists, related articles, comment lists) decide each
 * materialised item's visibility from its registered data: own rules first,
 * then an optional "first N visible" cap in DOM order. `measured` turns true
 * once the host has activated, so counts and empty states only show then.
 */
export function visibilityView<T>(ordered: readonly (readonly [string, T])[], visible: (data: T) => boolean, limit?: number): { visible: ReadonlyMap<string, boolean>; count: number } {
  const capped = limit !== undefined && limit > 0;
  const views = new Map<string, boolean>();
  let count = 0;
  for (const [id, data] of ordered) {
    const shown = visible(data) && (!capped || count < limit);
    if (shown) count += 1;
    views.set(id, shown);
  }
  return { visible: views, count };
}

export interface LocalComment {
  id: string;
  name: string;
  date: string;
  body: string;
  articleSlug: string;
}

// Session-only store: the comment form and the comment list are sibling
// nodes, neither hosting the other, so they meet here. Nothing persists.
const localComments = new Map<string, LocalComment[]>();
const commentListeners = new Set<() => void>();

export function addLocalComment(pathname: string, comment: LocalComment): void {
  localComments.set(pathname, [...(localComments.get(pathname) ?? []), comment]);
  for (const listener of commentListeners) listener();
}

export function resetLocalComments(): void {
  localComments.clear();
  for (const listener of commentListeners) listener();
}

/** This page's session comments as a signal for one component scope. */
export function localCommentsSignal(pathname: string): ReadonlySignal<readonly LocalComment[]> {
  const comments = signal<readonly LocalComment[]>(localComments.get(pathname) ?? []);
  getScope().onActivate(() => {
    const listener = () => {
      comments.value = localComments.get(pathname) ?? [];
    };
    commentListeners.add(listener);
    listener();
    return () => {
      commentListeners.delete(listener);
    };
  });
  return comments;
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MOCK_DELAY_MS = 600;

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatMediumDate(date: Date): string {
  return `${monthNames[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

export function readingMinutes(bodyLength: number): number {
  return bodyLength > 0 ? Math.ceil(bodyLength / 1100) : 0;
}

export function nonEmpty(values: readonly (string | undefined)[]): string[] {
  return values.map((value) => value?.trim() ?? "").filter((value) => value !== "");
}
