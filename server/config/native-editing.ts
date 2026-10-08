/** Explicit host opt-in. Semantic kinds never derive from component names. */
export interface NativeEditingConfig {
  source: "workspace";
  paragraph?: { componentId: string; textProp: string };
  list?: { componentId: string; itemsProp: string };
  image?: { componentId: string; srcProp: string; altProp: string };
  table?: { componentId: string; columnsProp: string; rowsProp: string };
}

export function parseNativeEditing(value: unknown): NativeEditingConfig | undefined {
  if (value === undefined) return undefined;
  const object = (input: unknown, keys: readonly string[], path: string): Record<string, unknown> => {
    if (!input || typeof input !== "object" || Array.isArray(input)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error(`${path} must be a plain object.`);
    const result = input as Record<string, unknown>;
    for (const key of Object.keys(result)) if (!keys.includes(key)) throw new Error(`${path}.${key} is not supported.`);
    return result;
  };
  const declarations = { paragraph: ["componentId", "textProp"], list: ["componentId", "itemsProp"], image: ["componentId", "srcProp", "altProp"], table: ["componentId", "columnsProp", "rowsProp"] } as const;
  const input = object(value, ["source", ...Object.keys(declarations)], "nativeEditing");
  if (input.source !== "workspace") throw new Error('nativeEditing.source must be "workspace".');
  const result: Record<string, unknown> = { source: "workspace" };
  const components = new Set<string>();
  for (const [kind, keys] of Object.entries(declarations)) {
    if (input[kind] === undefined) continue;
    const declaration = object(input[kind], keys, `nativeEditing.${kind}`);
    for (const key of keys) if (typeof declaration[key] !== "string" || !(declaration[key] as string).trim() || declaration[key] !== (declaration[key] as string).trim()) throw new Error(`nativeEditing.${kind}.${key} must be a nonempty unpadded string.`);
    if (components.has(declaration.componentId as string)) throw new Error("Native editing kinds must declare distinct component IDs.");
    components.add(declaration.componentId as string);
    const props = keys.filter((key) => key !== "componentId").map((key) => declaration[key]);
    if (new Set(props).size !== props.length || props.some((key) => ["__proto__", "prototype", "constructor", "key", "ref"].includes(key as string))) throw new Error(`nativeEditing.${kind} has duplicate or reserved props.`);
    result[kind] = { ...declaration };
  }
  return result as unknown as NativeEditingConfig;
}
