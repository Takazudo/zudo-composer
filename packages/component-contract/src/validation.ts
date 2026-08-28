import {
  COMPONENT_DOCUMENT_KIND,
  COMPONENT_PACK_KIND,
  CONTRACT_VERSION,
  ContractValidationError,
  DOCUMENT_VERSION,
  type AuthorComponentDefinition,
  type ComponentDocument,
  type ComponentManifest,
  type ComponentPackManifest,
  type ComponentRuntimeRegistry,
  type FieldDefinition,
  type ContractIssueCode,
  type JsonObject,
  type PersistedComponentNode,
  type PropDefinition,
  type PublicSourceDefinition,
  type RuntimeSchema,
  type ScalarPropValue,
  type SlotDefinition,
  type TrustedComponentPack,
} from './types.js';

export const RESERVED_PERSISTED_KEYS = Object.freeze([
  '__proto__',
  'componentId',
  'componentVersion',
  'constructor',
  'fields',
  'id',
  'props',
  'prototype',
  'schemaVersion',
  'slots',
] as const);

const reservedKeys = new Set<string>(RESERVED_PERSISTED_KEYS);
const identifierPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const packageImportPattern = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)(?:\/[A-Za-z0-9._~-]+)*$/u;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type PackComponentInput<TRuntime> = {
  readonly id: string;
  readonly schemaVersion: number;
  readonly displayName: string;
  readonly props: readonly PropDefinition<string>[];
  readonly defaults?: Readonly<Record<string, ScalarPropValue>>;
  readonly fields?: readonly FieldDefinition<string>[];
  readonly slots?: readonly SlotDefinition<string, string>[];
  readonly sources?: readonly PublicSourceDefinition<string>[];
  readonly runtime: TRuntime;
};

function issue(code: ContractIssueCode, path: string, message: string): ContractValidationError {
  return new ContractValidationError([{ code, path, message }]);
}

function fail(code: ContractIssueCode, path: string, message: string): never {
  throw issue(code, path, message);
}

function objectAt(input: unknown, path: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    fail('INVALID_VALUE', path, 'expected an object');
  }
  return input as Record<string, unknown>;
}

function arrayAt(input: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(input)) fail('INVALID_VALUE', path, 'expected an array');
  return input;
}

function stringAt(input: unknown, path: string): string {
  if (typeof input !== 'string' || input.length === 0) fail('INVALID_VALUE', path, 'expected a non-empty string');
  return input;
}

function positiveIntegerAt(input: unknown, path: string): number {
  if (!Number.isSafeInteger(input) || (input as number) < 1) {
    fail('INVALID_VALUE', path, 'expected a positive safe integer');
  }
  return input as number;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const allow = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allow.has(key)) fail('UNKNOWN_KEY', `${path}.${key}`, `unknown key ${JSON.stringify(key)}`);
  }
}

function noInlineAdapter(value: Record<string, unknown>, path: string): void {
  for (const key of Object.keys(value)) {
    if (/adapter/iu.test(key)) {
      fail('INLINE_ADAPTER_NOT_ALLOWED', `${path}.${key}`, 'inline source adapters are not part of contract v1');
    }
  }
}

function unique(values: readonly string[], code: ContractIssueCode, path: string, label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) fail(code, path, `duplicate ${label} ${JSON.stringify(value)}`);
    seen.add(value);
  }
}

function persistedKeyAt(input: unknown, path: string): string {
  const value = stringAt(input, path);
  if (reservedKeys.has(value)) fail('RESERVED_KEY', path, `${JSON.stringify(value)} is reserved by the document contract`);
  return value;
}

function assertJsonValue(value: unknown, path: string, ancestors = new Set<object>()): asserts value is import('./types.js').JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('INVALID_JSON_VALUE', path, 'numbers must be finite JSON numbers');
    return;
  }
  if (typeof value !== 'object') fail('INVALID_JSON_VALUE', path, 'value must be JSON-serializable');
  const object = value as object;
  if (ancestors.has(object)) fail('INVALID_JSON_VALUE', path, 'cyclic values are not JSON-serializable');
  ancestors.add(object);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`, ancestors));
  } else {
    const record = value as Record<string, unknown>;
    const prototype = Object.getPrototypeOf(record) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      fail('INVALID_JSON_VALUE', path, 'JSON objects must be plain objects');
    }
    if (Object.getOwnPropertySymbols(record).length > 0) {
      fail('INVALID_JSON_VALUE', path, 'symbol-keyed data is not JSON-serializable');
    }
    for (const [key, item] of Object.entries(record)) assertJsonValue(item, `${path}.${key}`, ancestors);
  }
  ancestors.delete(object);
}

function scalarAt(value: unknown, path: string): ScalarPropValue {
  assertJsonValue(value, path);
  if (value !== null && typeof value === 'object') fail('INVALID_VALUE', path, 'persisted props must be scalar JSON values');
  return value as ScalarPropValue;
}

function parseComponent(input: unknown, path: string): ComponentManifest {
  const value = objectAt(input, path);
  noInlineAdapter(value, path);
  exactKeys(value, ['id', 'schemaVersion', 'displayName', 'props', 'defaults', 'fields', 'slots', 'sources'], path);
  const id = stringAt(value.id, `${path}.id`);
  const schemaVersion = positiveIntegerAt(value.schemaVersion, `${path}.schemaVersion`);
  const displayName = stringAt(value.displayName, `${path}.displayName`);

  const props = arrayAt(value.props ?? [], `${path}.props`).map((item, index) => {
    const propPath = `${path}.props[${index}]`;
    const prop = objectAt(item, propPath);
    exactKeys(prop, ['prop', 'kind', 'required'], propPath);
    const name = persistedKeyAt(prop.prop, `${propPath}.prop`);
    if (!['string', 'number', 'boolean', 'null'].includes(String(prop.kind))) {
      fail('INVALID_VALUE', `${propPath}.kind`, 'expected string, number, boolean, or null');
    }
    if (prop.required !== undefined && typeof prop.required !== 'boolean') {
      fail('INVALID_VALUE', `${propPath}.required`, 'expected a boolean');
    }
    return { prop: name, kind: prop.kind as 'string' | 'number' | 'boolean' | 'null', ...(prop.required === undefined ? {} : { required: prop.required }) };
  });
  unique(props.map((prop) => prop.prop), 'DUPLICATE_PROP', `${path}.props`, 'prop');

  const defaultsValue = objectAt(value.defaults ?? {}, `${path}.defaults`);
  const defaults: Record<string, ScalarPropValue> = Object.create(null) as Record<string, ScalarPropValue>;
  const propNames = new Set(props.map((prop) => prop.prop));
  for (const [key, defaultValue] of Object.entries(defaultsValue)) {
    persistedKeyAt(key, `${path}.defaults.${key}`);
    if (!propNames.has(key)) fail('INVALID_VALUE', `${path}.defaults.${key}`, 'default must name a declared prop');
    const parsed = scalarAt(defaultValue, `${path}.defaults.${key}`);
    const definition = props.find((prop) => prop.prop === key);
    if (definition?.kind !== (parsed === null ? 'null' : typeof parsed)) {
      fail('INVALID_VALUE', `${path}.defaults.${key}`, `default does not match declared ${definition?.kind} prop kind`);
    }
    defaults[key] = parsed;
  }

  const fields = arrayAt(value.fields ?? [], `${path}.fields`).map((item, index) => {
    const fieldPath = `${path}.fields[${index}]`;
    const field = objectAt(item, fieldPath);
    exactKeys(field, ['id'], fieldPath);
    return { id: persistedKeyAt(field.id, `${fieldPath}.id`) };
  });
  unique(fields.map((field) => field.id), 'DUPLICATE_FIELD_ID', `${path}.fields`, 'field id');

  const slots = arrayAt(value.slots ?? [], `${path}.slots`).map((item, index) => {
    const slotPath = `${path}.slots[${index}]`;
    const slot = objectAt(item, slotPath);
    exactKeys(slot, ['id', 'accepts'], slotPath);
    const accepts = arrayAt(slot.accepts ?? [], `${slotPath}.accepts`).map((accepted, acceptedIndex) =>
      stringAt(accepted, `${slotPath}.accepts[${acceptedIndex}]`),
    );
    unique(accepts, 'DUPLICATE_ACCEPTS', `${slotPath}.accepts`, 'accepted component id');
    return { id: persistedKeyAt(slot.id, `${slotPath}.id`), accepts };
  });
  unique(slots.map((slot) => slot.id), 'DUPLICATE_SLOT_ID', `${path}.slots`, 'slot id');

  const sources = arrayAt(value.sources ?? [], `${path}.sources`).map((item, index) => {
    const sourcePath = `${path}.sources[${index}]`;
    const source = objectAt(item, sourcePath);
    noInlineAdapter(source, sourcePath);
    exactKeys(source, ['id', 'module', 'export'], sourcePath);
    const module = stringAt(source.module, `${sourcePath}.module`);
    if (!packageImportPattern.test(module) || module.split('/').includes('src')) {
      fail('INVALID_PUBLIC_IMPORT', `${sourcePath}.module`, 'expected a public bare-package import without private src segments');
    }
    const exportName = stringAt(source.export, `${sourcePath}.export`);
    if (!identifierPattern.test(exportName)) {
      fail('INVALID_PUBLIC_EXPORT', `${sourcePath}.export`, 'expected a JavaScript export identifier');
    }
    return { id: persistedKeyAt(source.id, `${sourcePath}.id`), module, export: exportName };
  });
  unique(sources.map((source) => source.id), 'DUPLICATE_SOURCE_ID', `${path}.sources`, 'source id');

  return { id, schemaVersion, displayName, props, defaults, fields, slots, sources };
}

function parsePack(input: unknown): ComponentPackManifest {
  const value = objectAt(input, '$');
  // Check the major before other fields so consumers never inspect/render an unsupported envelope.
  if (value.contractVersion !== CONTRACT_VERSION) {
    fail('UNSUPPORTED_CONTRACT_VERSION', '$.contractVersion', `unsupported component-pack contract version ${String(value.contractVersion)}`);
  }
  exactKeys(value, ['kind', 'contractVersion', 'packId', 'packVersion', 'components'], '$');
  if (value.kind !== COMPONENT_PACK_KIND) fail('INVALID_VALUE', '$.kind', `expected ${JSON.stringify(COMPONENT_PACK_KIND)}`);
  const packId = stringAt(value.packId, '$.packId');
  const packVersion = stringAt(value.packVersion, '$.packVersion');
  const components = arrayAt(value.components, '$.components').map((component, index) => parseComponent(component, `$.components[${index}]`));
  unique(components.map((component) => component.id), 'DUPLICATE_COMPONENT_ID', '$.components', 'component id');
  const componentIds = new Set(components.map((component) => component.id));
  for (const [componentIndex, component] of components.entries()) {
    for (const [slotIndex, slot] of component.slots.entries()) {
      for (const [acceptsIndex, accepted] of (slot.accepts ?? []).entries()) {
        if (!componentIds.has(accepted)) {
          fail('UNRESOLVED_ACCEPTS', `$.components[${componentIndex}].slots[${slotIndex}].accepts[${acceptsIndex}]`, `unknown component id ${JSON.stringify(accepted)}`);
        }
      }
    }
  }
  return { kind: COMPONENT_PACK_KIND, contractVersion: CONTRACT_VERSION, packId, packVersion, components };
}

function parseNode(input: unknown, path: string, ancestors: Set<object>): PersistedComponentNode {
  const value = objectAt(input, path);
  if (ancestors.has(value)) fail('INVALID_JSON_VALUE', path, 'cyclic component nodes are not JSON-serializable');
  ancestors.add(value);
  exactKeys(value, ['id', 'componentId', 'componentVersion', 'props', 'fields', 'slots'], path);
  const propsValue = objectAt(value.props ?? {}, `${path}.props`);
  const props: Record<string, ScalarPropValue> = Object.create(null) as Record<string, ScalarPropValue>;
  for (const [key, propValue] of Object.entries(propsValue)) {
    persistedKeyAt(key, `${path}.props.${key}`);
    props[key] = scalarAt(propValue, `${path}.props.${key}`);
  }
  const fields = objectAt(value.fields ?? {}, `${path}.fields`);
  assertJsonValue(fields, `${path}.fields`);
  const slotsValue = objectAt(value.slots ?? {}, `${path}.slots`);
  const slots: Mutable<PersistedComponentNode['slots']> = Object.create(null) as Mutable<PersistedComponentNode['slots']>;
  for (const [key, nodes] of Object.entries(slotsValue)) {
    persistedKeyAt(key, `${path}.slots.${key}`);
    slots[key] = arrayAt(nodes, `${path}.slots.${key}`).map((node, index) => parseNode(node, `${path}.slots.${key}[${index}]`, ancestors));
  }
  ancestors.delete(value);
  return {
    id: stringAt(value.id, `${path}.id`),
    componentId: stringAt(value.componentId, `${path}.componentId`),
    componentVersion: positiveIntegerAt(value.componentVersion, `${path}.componentVersion`),
    props,
    fields: fields as JsonObject,
    slots,
  };
}

function parseDocument(input: unknown): ComponentDocument {
  const value = objectAt(input, '$');
  if (value.documentVersion !== DOCUMENT_VERSION) {
    fail('UNSUPPORTED_DOCUMENT_VERSION', '$.documentVersion', `unsupported component document version ${String(value.documentVersion)}`);
  }
  exactKeys(value, ['kind', 'documentVersion', 'packId', 'packVersion', 'roots'], '$');
  if (value.kind !== COMPONENT_DOCUMENT_KIND) fail('INVALID_VALUE', '$.kind', `expected ${JSON.stringify(COMPONENT_DOCUMENT_KIND)}`);
  return {
    kind: COMPONENT_DOCUMENT_KIND,
    documentVersion: DOCUMENT_VERSION,
    packId: stringAt(value.packId, '$.packId'),
    packVersion: stringAt(value.packVersion, '$.packVersion'),
    roots: arrayAt(value.roots, '$.roots').map((node, index) => parseNode(node, `$.roots[${index}]`, new Set())),
  };
}

function schema<T>(parser: (input: unknown) => T): RuntimeSchema<T> {
  return Object.freeze({
    parse: parser,
    safeParse(input: unknown) {
      try {
        return { success: true as const, data: parser(input) };
      } catch (error) {
        if (error instanceof ContractValidationError) return { success: false as const, error };
        throw error;
      }
    },
  });
}

export const componentPackManifestSchema = schema(parsePack);
export const componentDocumentSchema = schema(parseDocument);

export function validateRuntimeParity<TRuntime>(
  manifestInput: unknown,
  runtime: ComponentRuntimeRegistry<TRuntime>,
): TrustedComponentPack<TRuntime> {
  const manifest = componentPackManifestSchema.parse(manifestInput);
  if (runtime.packId !== manifest.packId || runtime.packVersion !== manifest.packVersion) {
    fail('RUNTIME_MANIFEST_MISMATCH', '$runtime', 'runtime pack identity must exactly match the serializable manifest');
  }
  const manifestIds = new Set(manifest.components.map((component) => component.id));
  for (const component of manifest.components) {
    const entry = Object.hasOwn(runtime.components, component.id) ? runtime.components[component.id] : undefined;
    if (entry === undefined) {
      fail('MISSING_RUNTIME_ENTRY', `$runtime.components.${component.id}`, `missing trusted runtime entry for ${JSON.stringify(component.id)}`);
    }
    if (entry.schemaVersion !== component.schemaVersion) {
      fail('RUNTIME_COMPONENT_VERSION_MISMATCH', `$runtime.components.${component.id}.schemaVersion`, `runtime version ${entry.schemaVersion} does not match manifest version ${component.schemaVersion}`);
    }
  }
  for (const id of Object.keys(runtime.components)) {
    if (!manifestIds.has(id)) {
      fail('RUNTIME_MANIFEST_MISMATCH', `$runtime.components.${id}`, `runtime entry ${JSON.stringify(id)} has no serializable manifest component`);
    }
  }
  return { manifest, runtime };
}

export function defineComponentPack<TRuntime>(input: {
  readonly packId: string;
  readonly packVersion: string;
  readonly components: readonly PackComponentInput<TRuntime>[];
}): TrustedComponentPack<TRuntime> {
  const manifestInput = {
    kind: COMPONENT_PACK_KIND,
    contractVersion: CONTRACT_VERSION,
    packId: input.packId,
    packVersion: input.packVersion,
    components: input.components.map((component) => ({
      id: component.id,
      schemaVersion: component.schemaVersion,
      displayName: component.displayName,
      props: component.props,
      defaults: component.defaults,
      fields: component.fields,
      slots: component.slots,
      sources: component.sources,
    })),
  };
  const runtimeComponents: Record<string, { schemaVersion: number; runtime: TRuntime }> = Object.create(null) as Record<string, { schemaVersion: number; runtime: TRuntime }>;
  for (const component of input.components) {
    if (Object.hasOwn(runtimeComponents, component.id)) {
      // The manifest parser supplies the canonical duplicate diagnostic.
      continue;
    }
    runtimeComponents[component.id] = { schemaVersion: component.schemaVersion, runtime: component.runtime };
  }
  return validateRuntimeParity(manifestInput, {
    packId: input.packId,
    packVersion: input.packVersion,
    components: runtimeComponents,
  });
}

export function defineComponent<
  TProps extends object,
  TRuntime,
  TComponentId extends string,
  TField extends string = never,
  TSlot extends string = never,
  TSource extends string = never,
>(definition: AuthorComponentDefinition<TProps, TRuntime, TComponentId, TField, TSlot, TSource>): AuthorComponentDefinition<TProps, TRuntime, TComponentId, TField, TSlot, TSource> {
  return definition;
}
