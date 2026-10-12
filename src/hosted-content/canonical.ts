/** JSON canonicalization used for identities. Rejects values JSON would silently lose. */
export function canonicalSerialize(value: unknown): string {
  const ancestors = new Set<object>();
  function encode(item: unknown): string {
    if (item === null || typeof item === "boolean" || typeof item === "string") return JSON.stringify(item);
    if (typeof item === "number" && Number.isFinite(item)) return JSON.stringify(item);
    if (typeof item !== "object" || item === null || ancestors.has(item)) throw new TypeError("Expected finite, acyclic JSON.");
    const prototype = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) throw new TypeError("Expected plain JSON objects.");
    ancestors.add(item);
    let result: string;
    if (Array.isArray(item)) {
      const values: string[] = [];
      for (let index = 0; index < item.length; index++) values.push(encode(item[index]));
      result = `[${values.join(",")}]`;
    } else {
      result = `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${encode((item as Record<string, unknown>)[key])}`).join(",")}}`;
    }
    ancestors.delete(item);
    return result;
  }
  return encode(value);
}
