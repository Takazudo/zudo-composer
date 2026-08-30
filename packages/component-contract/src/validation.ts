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
  type ContractIssueCode,
  type FieldDefinition,
  type JsonObject,
  type PersistedComponentNode,
  type PublicSourceDefinition,
  type RuntimeAdapters,
  type RuntimeComponentEntry,
  type RuntimeSchema,
  type SlotDefinition,
  type StaticPropDefinition,
  type TrustedComponentPack,
} from './types.js';

export const RESERVED_PERSISTED_KEYS = Object.freeze([
  '__proto__',
  'constructor',
  'dangerouslySetInnerHTML',
  'key',
  'prototype',
  'ref',
] as const);

const reservedKeys = new Set<string>(RESERVED_PERSISTED_KEYS);
const identifierPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const packageImportPattern = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)(?:\/[A-Za-z0-9._~-]+)*$/u;

type Mutable<T> = { -readonly [TKey in keyof T]: T[TKey] };
type PackComponentInput<TComponent> = Omit<ComponentManifest, 'defaults' | 'fields' | 'slots' | 'staticProps'> & {
  readonly defaults?: unknown;
  readonly fields?: readonly unknown[];
  readonly slots?: readonly unknown[];
  readonly staticProps?: readonly unknown[];
  readonly component: TComponent;
  readonly adapters?: unknown;
};

function fail(code: ContractIssueCode, path: string, message: string): never {
  throw new ContractValidationError([{ code, path, message }]);
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

function stringAt(input: unknown, path: string, allowEmpty = false): string {
  if (typeof input !== 'string' || (!allowEmpty && input.length === 0)) {
    fail('INVALID_VALUE', path, `expected ${allowEmpty ? 'a string' : 'a non-empty string'}`);
  }
  return input;
}

function positiveIntegerAt(input: unknown, path: string): number {
  if (!Number.isSafeInteger(input) || (input as number) < 1) {
    fail('INVALID_VALUE', path, 'expected a positive safe integer');
  }
  return input as number;
}

function finiteNumberAt(input: unknown, path: string): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    fail('INVALID_FIELD_DOMAIN', path, 'expected a finite number');
  }
  return input;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const allow = new Set(allowed);
  if (Object.getOwnPropertySymbols(value).length > 0) fail('UNKNOWN_KEY', path, 'symbol keys are not part of the contract');
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!allow.has(key)) fail('UNKNOWN_KEY', `${path}.${key}`, `unknown key ${JSON.stringify(key)}`);
  }
}

function unique(values: readonly string[], code: ContractIssueCode, path: string, label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) fail(code, path, `duplicate ${label} ${JSON.stringify(value)}`);
    seen.add(value);
  }
}

function persistedPropAt(input: unknown, path: string): string {
  const value = stringAt(input, path);
  if (reservedKeys.has(value)) fail('RESERVED_KEY', path, `${JSON.stringify(value)} is reserved and cannot be persisted as a prop`);
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
    if (Object.getOwnPropertySymbols(value).length > 0) fail('INVALID_JSON_VALUE', path, 'symbol-keyed array data is not JSON-serializable');
    const expectedNames = value.map((_item, index) => String(index)).concat('length');
    if (Object.getOwnPropertyNames(value).some((name) => !expectedNames.includes(name))) {
      fail('INVALID_JSON_VALUE', path, 'custom array properties do not round-trip through JSON');
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) fail('INVALID_JSON_VALUE', `${path}[${index}]`, 'sparse arrays do not round-trip through JSON exactly');
      assertJsonValue(value[index], `${path}[${index}]`, ancestors);
    }
  } else {
    const record = value as Record<string, unknown>;
    const prototype = Object.getPrototypeOf(record) as object | null;
    if (prototype !== Object.prototype && prototype !== null) fail('INVALID_JSON_VALUE', path, 'JSON objects must be plain objects');
    if (Object.getOwnPropertySymbols(record).length > 0) fail('INVALID_JSON_VALUE', path, 'symbol-keyed data is not JSON-serializable');
    if (Reflect.ownKeys(record).length !== Object.keys(record).length) fail('INVALID_JSON_VALUE', path, 'non-enumerable data is not JSON-serializable');
    for (const [key, item] of Object.entries(record)) assertJsonValue(item, `${path}.${key}`, ancestors);
  }
  ancestors.delete(object);
}

function parseSource(input: unknown, path: string): PublicSourceDefinition {
  const value = objectAt(input, path);
  if (Object.keys(value).some((key) => /adapter/iu.test(key))) {
    fail('SOURCE_ADAPTER_NOT_ALLOWED', path, 'source adapters are not part of contract v1');
  }
  exactKeys(value, ['module', 'exportKind', 'exportName', 'localName'], path);
  const module = stringAt(value.module, `${path}.module`);
  if (!packageImportPattern.test(module) || module.split('/').includes('src')) {
    fail('INVALID_PUBLIC_IMPORT', `${path}.module`, 'expected a public bare-package import without private src segments');
  }
  if (value.exportKind !== 'named' && value.exportKind !== 'default') {
    fail('INVALID_VALUE', `${path}.exportKind`, 'expected named or default');
  }
  const exportName = stringAt(value.exportName, `${path}.exportName`);
  if (!identifierPattern.test(exportName)) fail('INVALID_PUBLIC_EXPORT', `${path}.exportName`, 'expected a JavaScript export identifier');
  const localName = value.localName === undefined ? undefined : stringAt(value.localName, `${path}.localName`);
  if (localName !== undefined && !identifierPattern.test(localName)) {
    fail('INVALID_PUBLIC_EXPORT', `${path}.localName`, 'expected a JavaScript local identifier');
  }
  return { module, exportKind: value.exportKind, exportName, ...(localName === undefined ? {} : { localName }) };
}

function parseRequired(input: unknown, path: string): boolean | undefined {
  if (input !== undefined && typeof input !== 'boolean') fail('INVALID_VALUE', path, 'expected a boolean');
  return input as boolean | undefined;
}

function parseField(input: unknown, path: string): FieldDefinition {
  const value = objectAt(input, path);
  const prop = persistedPropAt(value.prop, `${path}.prop`);
  const label = stringAt(value.label, `${path}.label`);
  const required = parseRequired(value.required, `${path}.required`);
  const common = { prop, label, ...(required === undefined ? {} : { required }) };
  switch (value.kind) {
    case 'text': {
      exactKeys(value, ['kind', 'prop', 'label', 'required', 'inlineEdit'], path);
      if (value.inlineEdit === undefined) return { kind: 'text', ...common };
      const inline = objectAt(value.inlineEdit, `${path}.inlineEdit`);
      exactKeys(inline, ['multiline', 'mode'], `${path}.inlineEdit`);
      if (inline.multiline !== undefined && typeof inline.multiline !== 'boolean') {
        fail('INVALID_VALUE', `${path}.inlineEdit.multiline`, 'expected a boolean');
      }
      if (inline.mode !== undefined && inline.mode !== 'plain' && inline.mode !== 'markdown-source') {
        fail('INVALID_VALUE', `${path}.inlineEdit.mode`, 'expected plain or markdown-source');
      }
      return {
        kind: 'text',
        ...common,
        inlineEdit: { multiline: inline.multiline ?? false, mode: inline.mode ?? 'plain' },
      };
    }
    case 'select': {
      exactKeys(value, ['kind', 'prop', 'label', 'required', 'options'], path);
      const options = arrayAt(value.options, `${path}.options`).map((option, index) => stringAt(option, `${path}.options[${index}]`));
      if (options.length === 0) fail('INVALID_FIELD_DOMAIN', `${path}.options`, 'select fields require at least one option');
      unique(options, 'DUPLICATE_SELECT_OPTION', `${path}.options`, 'select option');
      return { kind: 'select', ...common, options };
    }
    case 'boolean':
      exactKeys(value, ['kind', 'prop', 'label', 'required'], path);
      return { kind: 'boolean', ...common };
    case 'number': {
      exactKeys(value, ['kind', 'prop', 'label', 'required', 'min', 'max', 'step'], path);
      const min = value.min === undefined ? undefined : finiteNumberAt(value.min, `${path}.min`);
      const max = value.max === undefined ? undefined : finiteNumberAt(value.max, `${path}.max`);
      const step = value.step === undefined ? undefined : finiteNumberAt(value.step, `${path}.step`);
      if (min !== undefined && max !== undefined && min > max) fail('INVALID_FIELD_DOMAIN', path, 'number field min cannot exceed max');
      if (step !== undefined && step <= 0) fail('INVALID_FIELD_DOMAIN', `${path}.step`, 'number field step must be greater than zero');
      return { kind: 'number', ...common, ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }), ...(step === undefined ? {} : { step }) };
    }
    case 'color':
      exactKeys(value, ['kind', 'prop', 'label', 'required'], path);
      return { kind: 'color', ...common };
    default:
      fail('INVALID_VALUE', `${path}.kind`, 'expected text, select, boolean, number, or color');
  }
}

function parseSlot(input: unknown, path: string): SlotDefinition {
  const value = objectAt(input, path);
  exactKeys(value, ['id', 'prop', 'label', 'accepts', 'cardinality'], path);
  const accepts = value.accepts === undefined
    ? undefined
    : arrayAt(value.accepts, `${path}.accepts`).map((accepted, index) => stringAt(accepted, `${path}.accepts[${index}]`));
  if (accepts !== undefined) unique(accepts, 'DUPLICATE_ACCEPTS', `${path}.accepts`, 'accepted component id');
  if (value.cardinality !== 'single' && value.cardinality !== 'many') {
    fail('INVALID_VALUE', `${path}.cardinality`, 'expected single or many');
  }
  return {
    id: stringAt(value.id, `${path}.id`),
    prop: persistedPropAt(value.prop, `${path}.prop`),
    label: stringAt(value.label, `${path}.label`),
    ...(accepts === undefined ? {} : { accepts }),
    cardinality: value.cardinality,
  };
}

function parseStaticProp(input: unknown, path: string): StaticPropDefinition {
  const value = objectAt(input, path);
  exactKeys(value, ['prop', 'reason'], path);
  const reason = value.reason === undefined ? undefined : stringAt(value.reason, `${path}.reason`);
  return {
    prop: persistedPropAt(value.prop, `${path}.prop`),
    ...(reason === undefined ? {} : { reason }),
  };
}

function defaultMatchesStep(value: number, min: number | undefined, step: number): boolean {
  const units = (value - (min ?? 0)) / step;
  return Math.abs(units - Math.round(units)) < 1e-9;
}

function validateDefaults(
  defaults: JsonObject,
  fields: readonly FieldDefinition[],
  slots: readonly SlotDefinition[],
  staticProps: readonly StaticPropDefinition[],
  path: string,
): void {
  const slotProps = new Set(slots.map((slot) => slot.prop));
  const classifiedProps = new Set([...fields.map((field) => field.prop), ...staticProps.map((entry) => entry.prop)]);
  for (const prop of Object.keys(defaults)) {
    persistedPropAt(prop, `${path}.${prop}`);
    if (slotProps.has(prop)) fail('FIELD_SLOT_PROP_COLLISION', `${path}.${prop}`, 'structural slot props cannot have defaults');
    if (!classifiedProps.has(prop)) {
      fail('UNCLASSIFIED_DEFAULT', `${path}.${prop}`, 'defaults must correspond to an authorable field or an explicitly static prop');
    }
  }
  for (const field of fields) {
    const hasDefault = Object.hasOwn(defaults, field.prop);
    if (field.required === true && !hasDefault) {
      fail('REQUIRED_DEFAULT_MISSING', `${path}.${field.prop}`, 'required fields must have a default');
    }
    if (!hasDefault) continue;
    const value = defaults[field.prop];
    const invalid = (message: string): never => fail('INVALID_FIELD_DOMAIN', `${path}.${field.prop}`, message);
    switch (field.kind) {
      case 'text':
      case 'color':
        if (typeof value !== 'string') invalid(`${field.kind} field defaults must be strings`);
        break;
      case 'select':
        if (typeof value !== 'string' || !field.options.includes(value)) invalid('select default must be one of its options');
        break;
      case 'boolean':
        if (typeof value !== 'boolean') invalid('boolean field defaults must be booleans');
        break;
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) invalid('number field defaults must be finite numbers');
        if (field.min !== undefined && (value as number) < field.min) invalid(`number default is below min ${field.min}`);
        if (field.max !== undefined && (value as number) > field.max) invalid(`number default is above max ${field.max}`);
        if (field.step !== undefined && !defaultMatchesStep(value as number, field.min, field.step)) invalid(`number default does not align to step ${field.step}`);
        break;
    }
  }
}

function parseComponent(input: unknown, path: string): ComponentManifest {
  const value = objectAt(input, path);
  if (Object.hasOwn(value, 'component') || Object.hasOwn(value, 'adapters')) {
    fail('TRUSTED_VALUE_IN_MANIFEST', path, 'component and adapters are trusted runtime values and cannot enter a manifest');
  }
  exactKeys(value, ['id', 'schemaVersion', 'title', 'category', 'description', 'source', 'defaults', 'fields', 'slots', 'staticProps'], path);
  const defaultsValue = objectAt(value.defaults ?? {}, `${path}.defaults`);
  assertJsonValue(defaultsValue, `${path}.defaults`);
  const defaults = defaultsValue as JsonObject;
  const fields = arrayAt(value.fields ?? [], `${path}.fields`).map((field, index) => parseField(field, `${path}.fields[${index}]`));
  unique(fields.map((field) => field.prop), 'DUPLICATE_FIELD_PROP', `${path}.fields`, 'field prop');
  const inlineFields = fields.filter((field) => field.kind === 'text' && field.inlineEdit !== undefined);
  if (inlineFields.length > 1) fail('MULTIPLE_INLINE_EDIT_FIELDS', `${path}.fields`, 'contract v1 allows at most one inline-editable field');
  const slots = arrayAt(value.slots ?? [], `${path}.slots`).map((slot, index) => parseSlot(slot, `${path}.slots[${index}]`));
  unique(slots.map((slot) => slot.id), 'DUPLICATE_SLOT_ID', `${path}.slots`, 'slot id');
  unique(slots.map((slot) => slot.prop), 'DUPLICATE_SLOT_PROP', `${path}.slots`, 'slot prop');
  const fieldProps = new Set(fields.map((field) => field.prop));
  const collision = slots.find((slot) => fieldProps.has(slot.prop));
  if (collision !== undefined) fail('FIELD_SLOT_PROP_COLLISION', `${path}.slots`, `prop ${JSON.stringify(collision.prop)} is both a field and a slot`);
  const staticProps = arrayAt(value.staticProps ?? [], `${path}.staticProps`)
    .map((entry, index) => parseStaticProp(entry, `${path}.staticProps[${index}]`));
  unique(staticProps.map((entry) => entry.prop), 'DUPLICATE_STATIC_PROP', `${path}.staticProps`, 'static prop');
  const staticCollision = staticProps.find((entry) => fieldProps.has(entry.prop) || slots.some((slot) => slot.prop === entry.prop));
  if (staticCollision !== undefined) {
    fail('STATIC_PROP_COLLISION', `${path}.staticProps`, `prop ${JSON.stringify(staticCollision.prop)} cannot be both authorable and static`);
  }
  validateDefaults(defaults, fields, slots, staticProps, `${path}.defaults`);
  return {
    id: stringAt(value.id, `${path}.id`),
    schemaVersion: positiveIntegerAt(value.schemaVersion, `${path}.schemaVersion`),
    title: stringAt(value.title, `${path}.title`),
    category: stringAt(value.category, `${path}.category`),
    description: stringAt(value.description, `${path}.description`, true),
    source: parseSource(value.source, `${path}.source`),
    defaults,
    fields,
    slots,
    staticProps,
  };
}

function parsePack(input: unknown): ComponentPackManifest {
  const value = objectAt(input, '$');
  if (value.contractVersion !== CONTRACT_VERSION) {
    fail('UNSUPPORTED_CONTRACT_VERSION', '$.contractVersion', `unsupported component-pack contract version ${String(value.contractVersion)}`);
  }
  exactKeys(value, ['kind', 'contractVersion', 'packId', 'packVersion', 'components'], '$');
  if (value.kind !== COMPONENT_PACK_KIND) fail('INVALID_VALUE', '$.kind', `expected ${JSON.stringify(COMPONENT_PACK_KIND)}`);
  const components = arrayAt(value.components, '$.components').map((component, index) => parseComponent(component, `$.components[${index}]`));
  unique(components.map((component) => component.id), 'DUPLICATE_COMPONENT_ID', '$.components', 'component id');
  unique(components.map((component) => `${component.source.exportKind}:${component.source.module}#${component.source.exportName}`), 'DUPLICATE_SOURCE', '$.components', 'source import');
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
  return {
    kind: COMPONENT_PACK_KIND,
    contractVersion: CONTRACT_VERSION,
    packId: stringAt(value.packId, '$.packId'),
    packVersion: stringAt(value.packVersion, '$.packVersion'),
    components,
  };
}

function parseNode(input: unknown, path: string, ancestors: Set<object>): PersistedComponentNode {
  const value = objectAt(input, path);
  if (ancestors.has(value)) fail('INVALID_JSON_VALUE', path, 'cyclic component nodes are not JSON-serializable');
  ancestors.add(value);
  exactKeys(value, ['id', 'componentId', 'componentVersion', 'props', 'slots'], path);
  const propsValue = objectAt(value.props ?? {}, `${path}.props`);
  assertJsonValue(propsValue, `${path}.props`);
  for (const prop of Object.keys(propsValue)) persistedPropAt(prop, `${path}.props.${prop}`);
  const slotsValue = objectAt(value.slots ?? {}, `${path}.slots`);
  const slots: Mutable<PersistedComponentNode['slots']> = Object.create(null) as Mutable<PersistedComponentNode['slots']>;
  for (const [slotId, nodes] of Object.entries(slotsValue)) {
    stringAt(slotId, `${path}.slots.${slotId}`);
    slots[slotId] = arrayAt(nodes, `${path}.slots.${slotId}`).map((node, index) => parseNode(node, `${path}.slots.${slotId}[${index}]`, ancestors));
  }
  ancestors.delete(value);
  return {
    id: stringAt(value.id, `${path}.id`),
    componentId: stringAt(value.componentId, `${path}.componentId`),
    componentVersion: positiveIntegerAt(value.componentVersion, `${path}.componentVersion`),
    props: propsValue as JsonObject,
    slots,
  };
}

function parseDocument(input: unknown): ComponentDocument {
  const value = objectAt(input, '$');
  if (value.documentVersion !== DOCUMENT_VERSION) {
    fail('UNSUPPORTED_DOCUMENT_VERSION', '$.documentVersion', `unsupported component document version ${String(value.documentVersion)}`);
  }
  exactKeys(value, ['kind', 'documentVersion', 'root'], '$');
  if (value.kind !== COMPONENT_DOCUMENT_KIND) fail('INVALID_VALUE', '$.kind', `expected ${JSON.stringify(COMPONENT_DOCUMENT_KIND)}`);
  return {
    kind: COMPONENT_DOCUMENT_KIND,
    documentVersion: DOCUMENT_VERSION,
    root: arrayAt(value.root, '$.root').map((node, index) => parseNode(node, `$.root[${index}]`, new Set())),
  };
}

function parseAdapters(input: unknown, path: string): RuntimeAdapters<Record<string, unknown>> {
  const value = objectAt(input, path);
  exactKeys(value, ['render', 'inlineEditor'], path);
  if (value.render !== undefined && typeof value.render !== 'function') fail('INVALID_VALUE', `${path}.render`, 'render adapter must be a function');
  let inlineEditor;
  if (value.inlineEditor !== undefined) {
    const inline = objectAt(value.inlineEditor, `${path}.inlineEditor`);
    exactKeys(inline, ['field', 'resolveElement'], `${path}.inlineEditor`);
    if (typeof inline.resolveElement !== 'function') fail('INVALID_VALUE', `${path}.inlineEditor.resolveElement`, 'inline editor resolver must be a function');
    inlineEditor = { field: persistedPropAt(inline.field, `${path}.inlineEditor.field`), resolveElement: inline.resolveElement as (root: unknown) => unknown };
  }
  return {
    ...(value.render === undefined ? {} : { render: value.render as (props: Partial<Record<string, unknown>>) => unknown }),
    ...(inlineEditor === undefined ? {} : { inlineEditor }),
  };
}

function parseRuntimeRegistry(input: unknown): ComponentRuntimeRegistry {
  const value = objectAt(input, '$runtime');
  exactKeys(value, ['packId', 'packVersion', 'components'], '$runtime');
  const inputComponents = objectAt(value.components, '$runtime.components');
  const prototype = Object.getPrototypeOf(inputComponents) as object | null;
  if (prototype !== Object.prototype && prototype !== null) fail('INVALID_VALUE', '$runtime.components', 'expected a plain runtime registry record');
  if (Object.getOwnPropertySymbols(inputComponents).length > 0 || Object.getOwnPropertyNames(inputComponents).length !== Object.keys(inputComponents).length) {
    fail('RUNTIME_MANIFEST_MISMATCH', '$runtime.components', 'runtime component entries must be enumerable string keys');
  }
  const components: Record<string, RuntimeComponentEntry> = Object.create(null) as Record<string, RuntimeComponentEntry>;
  for (const [id, inputEntry] of Object.entries(inputComponents)) {
    const entry = objectAt(inputEntry, `$runtime.components.${id}`);
    exactKeys(entry, ['schemaVersion', 'component', 'adapters'], `$runtime.components.${id}`);
    if (!Object.hasOwn(entry, 'component') || entry.component === undefined || entry.component === null) {
      fail('INVALID_VALUE', `$runtime.components.${id}.component`, 'trusted component value is required');
    }
    components[stringAt(id, `$runtime.components.${id}`)] = {
      schemaVersion: positiveIntegerAt(entry.schemaVersion, `$runtime.components.${id}.schemaVersion`),
      component: entry.component,
      ...(entry.adapters === undefined ? {} : { adapters: parseAdapters(entry.adapters, `$runtime.components.${id}.adapters`) }),
    };
  }
  return {
    packId: stringAt(value.packId, '$runtime.packId'),
    packVersion: stringAt(value.packVersion, '$runtime.packVersion'),
    components,
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
export const componentRuntimeRegistrySchema = schema(parseRuntimeRegistry);

export function validateRuntimeParity<TComponent, TRenderOutput = unknown, TElement = unknown>(
  manifestInput: unknown,
  runtimeInput: ComponentRuntimeRegistry<TComponent, TRenderOutput, TElement>,
): TrustedComponentPack<TComponent, TRenderOutput, TElement> {
  const manifest = componentPackManifestSchema.parse(manifestInput);
  const runtime = componentRuntimeRegistrySchema.parse(runtimeInput) as ComponentRuntimeRegistry<TComponent, TRenderOutput, TElement>;
  if (runtime.packId !== manifest.packId || runtime.packVersion !== manifest.packVersion) {
    fail('RUNTIME_MANIFEST_MISMATCH', '$runtime', 'runtime pack identity must exactly match the serializable manifest');
  }
  const manifestIds = new Set(manifest.components.map((component) => component.id));
  for (const component of manifest.components) {
    const entry = Object.hasOwn(runtime.components, component.id) ? runtime.components[component.id] : undefined;
    if (entry === undefined) fail('MISSING_RUNTIME_ENTRY', `$runtime.components.${component.id}`, `missing trusted runtime entry for ${JSON.stringify(component.id)}`);
    if (entry.schemaVersion !== component.schemaVersion) {
      fail('RUNTIME_COMPONENT_VERSION_MISMATCH', `$runtime.components.${component.id}.schemaVersion`, `runtime version ${entry.schemaVersion} does not match manifest version ${component.schemaVersion}`);
    }
    const inlineFields = component.fields.filter((field) => field.kind === 'text' && field.inlineEdit !== undefined);
    const adapterField = entry.adapters?.inlineEditor?.field;
    if (inlineFields.length === 1 && adapterField !== inlineFields[0]?.prop) {
      fail('INLINE_EDITOR_MISMATCH', `$runtime.components.${component.id}.adapters.inlineEditor`, `inline editor must target ${JSON.stringify(inlineFields[0]?.prop)}`);
    }
    if (inlineFields.length === 0 && adapterField !== undefined) {
      fail('INLINE_EDITOR_MISMATCH', `$runtime.components.${component.id}.adapters.inlineEditor.field`, 'inline editor targets a field that is not inline-editable');
    }
  }
  for (const id of Object.keys(runtime.components)) {
    if (!manifestIds.has(id)) fail('RUNTIME_MANIFEST_MISMATCH', `$runtime.components.${id}`, `runtime entry ${JSON.stringify(id)} has no serializable manifest component`);
  }
  return { manifest, runtime };
}

export function defineComponentPack<const TComponents extends readonly PackComponentInput<unknown>[]>(input: {
  readonly packId: string;
  readonly packVersion: string;
  readonly components: TComponents;
}): TrustedComponentPack<TComponents[number]['component']> {
  const manifestInput = {
    kind: COMPONENT_PACK_KIND,
    contractVersion: CONTRACT_VERSION,
    packId: input.packId,
    packVersion: input.packVersion,
    components: input.components.map((component, index) => {
      const authorValue = component as unknown as Record<string, unknown>;
      exactKeys(authorValue, ['id', 'schemaVersion', 'title', 'category', 'description', 'source', 'defaults', 'fields', 'slots', 'staticProps', 'component', 'adapters'], `$.components[${index}]`);
      const projected = { ...authorValue };
      delete projected.component;
      delete projected.adapters;
      return projected;
    }),
  };
  type TComponent = TComponents[number]['component'];
  const runtimeComponents: Record<string, RuntimeComponentEntry<TComponent>> = Object.create(null) as Record<string, RuntimeComponentEntry<TComponent>>;
  for (const component of input.components) {
    if (Object.hasOwn(runtimeComponents, component.id)) continue;
    runtimeComponents[component.id] = {
      schemaVersion: component.schemaVersion,
      component: component.component,
      ...(component.adapters === undefined ? {} : { adapters: component.adapters as RuntimeAdapters<Record<string, unknown>> }),
    };
  }
  return validateRuntimeParity(manifestInput, {
    packId: input.packId,
    packVersion: input.packVersion,
    components: runtimeComponents,
  });
}

export function defineComponent<
  TProps extends object = Record<string, unknown>,
  TComponent = unknown,
  TRenderOutput = unknown,
  TElement = unknown,
  TComponentId extends string = string,
>(definition: AuthorComponentDefinition<TProps, TComponent, TRenderOutput, TElement, TComponentId>): AuthorComponentDefinition<TProps, TComponent, TRenderOutput, TElement, TComponentId> {
  return definition;
}
