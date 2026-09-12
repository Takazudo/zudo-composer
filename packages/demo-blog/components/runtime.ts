import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

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
 * Items (materialised child nodes) report whether their own rules let them
 * show; the list host keeps them in mount order, which is DOM order, and
 * derives counts and an optional "first N visible" cap from that.
 */
export interface VisibilityRegistry {
  register(key: string, visible: boolean): void;
  unregister(key: string): void;
  /** False until the host has seen its items; caps only apply once measured. */
  measured: boolean;
  visibleCount: number;
  allowed(key: string): boolean;
}

export function useVisibilityRegistry(limit?: number): VisibilityRegistry {
  const entries = useRef(new Map<string, boolean>());
  const [version, setVersion] = useState(0);
  const [measured, setMeasured] = useState(false);
  useEffect(() => { setMeasured(true); }, []);
  const register = useCallback((key: string, visible: boolean) => {
    if (entries.current.get(key) === visible) return;
    entries.current.set(key, visible);
    setVersion((value) => value + 1);
  }, []);
  const unregister = useCallback((key: string) => {
    if (entries.current.delete(key)) setVersion((value) => value + 1);
  }, []);
  void version;
  const visibleKeys = [...entries.current].filter(([, visible]) => visible).map(([key]) => key);
  const capped = new Set(limit !== undefined && limit > 0 ? visibleKeys.slice(0, limit) : visibleKeys);
  return {
    register,
    unregister,
    measured,
    visibleCount: capped.size,
    allowed: (key: string) => !measured || limit === undefined || limit <= 0 || capped.has(key),
  };
}

let nextItemKey = 0;

/** Registers one item's own visibility with a host registry, when there is one. */
export function useRegisteredVisibility(registry: VisibilityRegistry | null, visible: boolean): boolean {
  const key = useMemo(() => `item-${nextItemKey++}`, []);
  const register = registry?.register;
  const unregister = registry?.unregister;
  useLayoutEffect(() => { register?.(key, visible); }, [register, key, visible]);
  useLayoutEffect(() => () => unregister?.(key), [unregister, key]);
  return visible && (registry ? registry.allowed(key) : true);
}

export interface LocalComment {
  id: string;
  name: string;
  date: string;
  body: string;
  articleSlug: string;
}

// Session-only store: the comment form and the comment list are sibling
// nodes, so they meet here rather than through a context. Nothing persists.
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

export function useLocalComments(pathname: string): readonly LocalComment[] {
  const [comments, setComments] = useState(() => localComments.get(pathname) ?? []);
  useEffect(() => {
    const listener = () => setComments(localComments.get(pathname) ?? []);
    commentListeners.add(listener);
    listener();
    return () => { commentListeners.delete(listener); };
  }, [pathname]);
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
