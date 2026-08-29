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
  let ok: boolean;
  if (Array.isArray(obj)) {
    const expectedNames = Array.from({ length: obj.length }, (_item, index) => String(index)).concat("length");
    ok = Object.getOwnPropertySymbols(obj).length === 0
      && Object.getOwnPropertyNames(obj).every((name) => expectedNames.includes(name))
      && Array.from({ length: obj.length }, (_item, index) => index)
        .every((index) => Object.hasOwn(obj, index) && isJsonSafe(obj[index], ancestors));
  } else {
    const record = obj as Record<string, unknown>;
    ok = Object.getOwnPropertySymbols(record).length === 0
      && Reflect.ownKeys(record).length === Object.keys(record).length
      && Object.values(record).every((child) => isJsonSafe(child, ancestors));
  }
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
 * Structural deep clone of a JSON-safe value. Rejects anything that would not
 * round-trip exactly, then uses JSON to produce a fresh, unshared tree.
 */
export function cloneJson<T extends JsonValue | object>(value: T): T {
  if (!isJsonSafe(value)) {
    throw new TypeError("Cannot clone a value that does not round-trip through JSON exactly.");
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
