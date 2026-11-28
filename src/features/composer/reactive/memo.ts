import { computed, type ReadonlySignal } from "@takazudo/zfb/zudo-react";

/** Identity for scalars; one level of identity comparison for arrays and plain objects. */
export function shallowEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left)) {
    const other = right as readonly unknown[];
    return left.length === other.length && left.every((value, index) => Object.is(value, other[index]));
  }
  if (Object.getPrototypeOf(left) !== Object.prototype || Object.getPrototypeOf(right) !== Object.prototype) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.hasOwn(right, key) && Object.is((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

/**
 * A `computed` that keeps its previous value while `equals` holds, the
 * replacement for `useMemo` with dependencies. zudo-react propagates every
 * upstream write, so a derivation that builds a fresh object would otherwise
 * hand `Rebuild`/`Keyed` a new identity (and a remount) on every update.
 */
export function memo<T>(read: () => T, equals: (left: T, right: T) => boolean = shallowEqual): ReadonlySignal<T> {
  let last: { value: T } | null = null;
  return computed(() => {
    const next = read();
    if (last !== null && equals(last.value, next)) return last.value;
    last = { value: next };
    return next;
  });
}
