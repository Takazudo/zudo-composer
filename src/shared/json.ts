// Pure JSON-safety helpers shared by the headless authoring models.
//
// This module deliberately has no app or persistence imports. Both authoring
// sub-apps use it to validate and detach the JSON documents they own.

import type { JsonValue } from "@zudo-composer/component-contract";

/**
 * Recursively decides whether a value is JSON-safe: only strings, finite
 * numbers, booleans, null, arrays, and plain objects — never functions,
 * `undefined`, symbols, bigints, class instances, or circular references.
 * `ancestors` tracks the CURRENT path only (backtracked after each branch) so
 * a shared reference in a DAG is not mistaken for a cycle.
 */
export function isJsonSafe(value: unknown, ancestors: Set<unknown> = new Set()): boolean {
  if (value === null) return true;
  const t = typeof value;
  if (t === "string" || t === "boolean") return true;
  if (t === "number") return Number.isFinite(value as number);
  if (t !== "object") return false; // undefined, function, symbol, bigint
  const obj = value as object;
  const proto = Object.getPrototypeOf(obj);
  if (!Array.isArray(obj) && proto !== Object.prototype && proto !== null) {
    return false; // Date, Map, class instance, VNode…
  }
  if (ancestors.has(obj)) return false; // cycle on the current path
  ancestors.add(obj);
  const children = Array.isArray(obj)
    ? obj
    : Object.values(obj as Record<string, unknown>);
  const ok = children.every((child) => isJsonSafe(child, ancestors));
  ancestors.delete(obj);
  return ok;
}

/** Narrowing guard: is `value` a plain (non-array) JSON object? */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Structural deep clone of a JSON-safe value. Uses a `JSON` round-trip, which
 * both guarantees a fresh, unshared tree and strips anything non-JSON — the
 * callers rely on this to stay pure and never leak a shared reference back to
 * their input document.
 */
export function cloneJson<T extends JsonValue | object>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
