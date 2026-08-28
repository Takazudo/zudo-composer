import { describe, expect, it } from 'vitest';
import {
  COMPONENT_DOCUMENT_KIND,
  COMPONENT_PACK_KIND,
  CONTRACT_VERSION,
  ContractValidationError,
  DOCUMENT_VERSION,
  componentDocumentSchema,
  componentPackManifestSchema,
  componentRuntimeRegistrySchema,
  defineComponent,
  defineComponentPack,
  resolveComponentNode,
  validateRuntimeParity,
  type ContractIssueCode,
} from './index.js';
import { fixtureComponentDocument, fixtureComponentPack } from './fixtures.js';

function manifest(): Record<string, unknown> {
  return structuredClone(fixtureComponentPack.manifest) as unknown as Record<string, unknown>;
}

function components(value: Record<string, unknown>): Record<string, unknown>[] {
  return value.components as Record<string, unknown>[];
}

function container(value: Record<string, unknown>): Record<string, unknown> {
  const entry = components(value)[0];
  if (entry === undefined) throw new Error('fixture container missing');
  return entry;
}

function expectCode(run: () => unknown, code: ContractIssueCode): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ContractValidationError);
    expect((error as ContractValidationError).issues[0]?.code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe('serializable component-pack contract v1', () => {
  it('keeps every version concept distinct and includes display/source metadata', () => {
    expect(fixtureComponentPack.manifest).toMatchObject({
      kind: COMPONENT_PACK_KIND,
      contractVersion: CONTRACT_VERSION,
      packVersion: '3.4.5',
    });
    expect(fixtureComponentPack.manifest.components[0]).toMatchObject({
      schemaVersion: 2,
      title: 'Container',
      category: 'Layout',
      description: 'A representative structural component.',
      source: { module: '@fixture/ui', exportKind: 'named', exportName: 'Container' },
    });
    expect(fixtureComponentDocument).toMatchObject({ kind: COMPONENT_DOCUMENT_KIND, documentVersion: DOCUMENT_VERSION });
  });

  it('expresses all editable field kinds, inline modes, and slot cardinalities', () => {
    const definitions = fixtureComponentPack.manifest.components;
    const kinds = new Set(definitions.flatMap((definition) => definition.fields.map((field) => field.kind)));
    expect(kinds).toEqual(new Set(['text', 'select', 'boolean', 'number', 'color']));
    expect(definitions.flatMap((definition) => definition.fields)
      .filter((field) => field.kind === 'text' && field.inlineEdit)
      .map((field) => field.inlineEdit?.mode)).toEqual(['plain', 'markdown-source']);
    expect(definitions[0]?.slots.map((slot) => slot.cardinality)).toEqual(['many', 'single']);
  });

  it('normalizes omitted defaults, fields, and slots without leaking trusted values', () => {
    const definition = defineComponent<{ title: string }, object>({
      id: 'card',
      schemaVersion: 1,
      title: 'Card',
      category: 'Content',
      description: '',
      source: { module: '@fixture/card', exportKind: 'default', exportName: 'Card' },
      component: {},
    });
    const pack = defineComponentPack({ packId: 'test-pack', packVersion: '1', components: [definition] });
    expect(pack.manifest.components[0]).toMatchObject({ defaults: {}, fields: [], slots: [] });
    expect(Object.hasOwn(pack.manifest.components[0] ?? {}, 'component')).toBe(false);
    expect(Object.hasOwn(pack.manifest.components[0] ?? {}, 'adapters')).toBe(false);
  });

  it('normalizes inline text defaults while preserving omitted accepts as unrestricted', () => {
    const definition = fixtureComponentPack.manifest.components[0];
    const title = definition?.fields.find((field) => field.prop === 'title');
    expect(title).toMatchObject({ inlineEdit: { multiline: false, mode: 'plain' } });
    const value = manifest();
    const firstSlot = (container(value).slots as Record<string, unknown>[])[0];
    delete firstSlot.accepts;
    const parsed = componentPackManifestSchema.parse(value);
    expect(parsed.components[0]?.slots[0]).not.toHaveProperty('accepts');
  });

  it('round-trips manifest and minimal document JSON exactly', () => {
    expect(componentPackManifestSchema.parse(JSON.parse(JSON.stringify(fixtureComponentPack.manifest))))
      .toEqual(fixtureComponentPack.manifest);
    expect(componentDocumentSchema.parse(JSON.parse(JSON.stringify(fixtureComponentDocument))))
      .toEqual(fixtureComponentDocument);
  });

  it('fails unsupported contract and document versions before other work', () => {
    expectCode(() => componentPackManifestSchema.parse({ contractVersion: 2, components: 'bad' }), 'UNSUPPORTED_CONTRACT_VERSION');
    expectCode(() => componentDocumentSchema.parse({ documentVersion: 2 }), 'UNSUPPORTED_DOCUMENT_VERSION');
  });

  it.each([
    ['component id', 'DUPLICATE_COMPONENT_ID', (value: Record<string, unknown>) => { components(value).push(structuredClone(components(value)[0])); }],
    ['field prop', 'DUPLICATE_FIELD_PROP', (value: Record<string, unknown>) => { const list = container(value).fields as unknown[]; list.push(structuredClone(list[0])); }],
    ['slot id', 'DUPLICATE_SLOT_ID', (value: Record<string, unknown>) => { const list = container(value).slots as unknown[]; list.push(structuredClone(list[0])); }],
    ['slot prop', 'DUPLICATE_SLOT_PROP', (value: Record<string, unknown>) => { const list = container(value).slots as Record<string, unknown>[]; list[1].prop = list[0].prop; }],
    ['accepts target', 'DUPLICATE_ACCEPTS', (value: Record<string, unknown>) => { const accepts = ((container(value).slots as Record<string, unknown>[])[0].accepts as string[]); accepts.push(accepts[0]); }],
    ['select option', 'DUPLICATE_SELECT_OPTION', (value: Record<string, unknown>) => { const field = (container(value).fields as Record<string, unknown>[])[1]; const options = field.options as string[]; options.push(options[0]); }],
    ['source import', 'DUPLICATE_SOURCE', (value: Record<string, unknown>) => { const duplicate = structuredClone(components(value)[0]); duplicate.id = 'duplicate-source'; components(value).push(duplicate); }],
  ] as const)('rejects duplicate %s identities', (_label, code, mutate) => {
    const value = manifest();
    mutate(value);
    expectCode(() => componentPackManifestSchema.parse(value), code);
  });

  it('rejects field/slot prop collisions and unresolved accepts', () => {
    const collision = manifest();
    (container(collision).slots as Record<string, unknown>[])[0].prop = 'title';
    expectCode(() => componentPackManifestSchema.parse(collision), 'FIELD_SLOT_PROP_COLLISION');

    const unresolved = manifest();
    ((container(unresolved).slots as Record<string, unknown>[])[0].accepts as string[]).push('missing');
    expectCode(() => componentPackManifestSchema.parse(unresolved), 'UNRESOLVED_ACCEPTS');
  });

  it.each(['dangerouslySetInnerHTML', 'key', 'ref', '__proto__', 'constructor'])('rejects reserved persisted prop %s', (prop) => {
    const value = manifest();
    (container(value).fields as Record<string, unknown>[])[0].prop = prop;
    expectCode(() => componentPackManifestSchema.parse(value), 'RESERVED_KEY');
  });

  it.each(['./private', '/absolute/private', 'https://example.test/ui', '@fixture/ui/src/Button', '#internal'])(
    'rejects non-public import %s', (module) => {
      const value = manifest();
      (container(value).source as Record<string, unknown>).module = module;
      expectCode(() => componentPackManifestSchema.parse(value), 'INVALID_PUBLIC_IMPORT');
    },
  );

  it.each(['default export', 'foo-bar', '2Button', 'foo.bar'])('rejects invalid export/local identifier %s', (name) => {
    const exported = manifest();
    (container(exported).source as Record<string, unknown>).exportName = name;
    expectCode(() => componentPackManifestSchema.parse(exported), 'INVALID_PUBLIC_EXPORT');
    const local = manifest();
    (container(local).source as Record<string, unknown>).localName = name;
    expectCode(() => componentPackManifestSchema.parse(local), 'INVALID_PUBLIC_EXPORT');
  });

  it('rejects the removed source adapter API', () => {
    const value = manifest();
    (container(value).source as Record<string, unknown>).adapter = () => 'unsafe';
    expectCode(() => componentPackManifestSchema.parse(value), 'SOURCE_ADAPTER_NOT_ALLOWED');
  });

  it('strictly validates required fields and default kinds/domains', () => {
    const missing = manifest();
    delete (container(missing).defaults as Record<string, unknown>).title;
    expectCode(() => componentPackManifestSchema.parse(missing), 'REQUIRED_DEFAULT_MISSING');

    const select = manifest();
    (container(select).defaults as Record<string, unknown>).layout = 'former-option';
    expectCode(() => componentPackManifestSchema.parse(select), 'INVALID_FIELD_DOMAIN');

    const boolean = manifest();
    (container(boolean).defaults as Record<string, unknown>).enabled = 'yes';
    expectCode(() => componentPackManifestSchema.parse(boolean), 'INVALID_FIELD_DOMAIN');

    const number = manifest();
    (container(number).defaults as Record<string, unknown>).columns = 2.5;
    expectCode(() => componentPackManifestSchema.parse(number), 'INVALID_FIELD_DOMAIN');

    const range = manifest();
    const numberField = (container(range).fields as Record<string, unknown>[])[3];
    numberField.min = 5;
    numberField.max = 1;
    expectCode(() => componentPackManifestSchema.parse(range), 'INVALID_FIELD_DOMAIN');
  });

  it('rejects structural defaults and multiple inline-editable fields', () => {
    const structural = manifest();
    (container(structural).defaults as Record<string, unknown>).children = [];
    expectCode(() => componentPackManifestSchema.parse(structural), 'FIELD_SLOT_PROP_COLLISION');

    const multiple = manifest();
    const fields = container(multiple).fields as Record<string, unknown>[];
    fields[4].kind = 'text';
    fields[4].inlineEdit = {};
    expectCode(() => componentPackManifestSchema.parse(multiple), 'MULTIPLE_INLINE_EDIT_FIELDS');
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, undefined, 1n, () => null, new Date()])(
    'rejects non-JSON persisted/default value %#', (badValue) => {
      const value = manifest();
      (container(value).defaults as Record<string, unknown>).bad = badValue;
      expectCode(() => componentPackManifestSchema.parse(value), 'INVALID_JSON_VALUE');
    },
  );

  it('rejects cyclic, sparse, and non-enumerable JSON data', () => {
    const cyclic = manifest();
    (container(cyclic).defaults as Record<string, unknown>).self = container(cyclic).defaults;
    expectCode(() => componentPackManifestSchema.parse(cyclic), 'INVALID_JSON_VALUE');

    const sparse = Array.from({ length: 1 }) as unknown[];
    delete sparse[0];
    const sparseDocument = structuredClone(fixtureComponentDocument) as unknown as Record<string, unknown>;
    const root = (sparseDocument.root as Record<string, unknown>[])[0];
    (root.props as Record<string, unknown>).sparse = sparse;
    expectCode(() => componentDocumentSchema.parse(sparseDocument), 'INVALID_JSON_VALUE');

    const hidden = manifest();
    Object.defineProperty(container(hidden).defaults, 'hidden', { value: 'lost', enumerable: false });
    expectCode(() => componentPackManifestSchema.parse(hidden), 'INVALID_JSON_VALUE');
  });

  it('persists arbitrary JSON props plus structural slots, with no invented fields bag', () => {
    const parsed = componentDocumentSchema.parse(fixtureComponentDocument);
    expect(parsed.root[0]?.props.analytics).toEqual({ tags: ['fixture'] });
    expect(parsed.root[0]?.slots.content?.[0]?.props.markdown).toBe('**Hello**');
    const legacy = structuredClone(fixtureComponentDocument) as unknown as Record<string, unknown>;
    (legacy.root as Record<string, unknown>[])[0].fields = {};
    expectCode(() => componentDocumentSchema.parse(legacy), 'UNKNOWN_KEY');
  });

  it('rejects excluded author APIs instead of silently discarding them', () => {
    const definition = {
      id: 'legacy', schemaVersion: 1, title: 'Legacy', category: 'Content', description: '',
      source: { module: '@fixture/legacy', exportKind: 'named' as const, exportName: 'Legacy' },
      component: {}, allowedParents: ['container'],
    };
    expectCode(() => defineComponentPack({ packId: 'test-pack', packVersion: '1', components: [definition] }), 'UNKNOWN_KEY');
  });
});

describe('trusted runtime projection', () => {
  it('strictly validates component, render, and inline-editor runtime values', () => {
    const component = () => null;
    const render = () => 'rendered';
    const resolveElement = (root: object) => root;
    const parsed = componentRuntimeRegistrySchema.parse({
      packId: 'pack', packVersion: '1',
      components: { card: { schemaVersion: 1, component, adapters: { render, inlineEditor: { field: 'title', resolveElement } } } },
    });
    expect(parsed.components.card?.component).toBe(component);
    expect(parsed.components.card?.adapters?.render).toBe(render);
    expect(parsed.components.card?.adapters?.inlineEditor?.resolveElement).toBe(resolveElement);
    expectCode(
      () => componentRuntimeRegistrySchema.parse({
        packId: 'pack', packVersion: '1', components: { card: { schemaVersion: 1, component: null } },
      }),
      'INVALID_VALUE',
    );
  });

  it('rejects trusted values in the serializable manifest', () => {
    const value = manifest();
    container(value).component = () => null;
    expectCode(() => componentPackManifestSchema.parse(value), 'TRUSTED_VALUE_IN_MANIFEST');
  });

  it('keeps runtime and manifest identity/version in exact parity', () => {
    expect(Object.keys(fixtureComponentPack.runtime.components).sort())
      .toEqual(fixtureComponentPack.manifest.components.map((component) => component.id).sort());
    expect(validateRuntimeParity(fixtureComponentPack.manifest, fixtureComponentPack.runtime)).toEqual(fixtureComponentPack);
  });

  it('diagnoses missing, extra, and version-drifted runtime entries', () => {
    const missing = { ...fixtureComponentPack.runtime.components };
    delete missing.prose;
    expectCode(() => validateRuntimeParity(fixtureComponentPack.manifest, { ...fixtureComponentPack.runtime, components: missing }), 'MISSING_RUNTIME_ENTRY');
    expectCode(() => validateRuntimeParity(fixtureComponentPack.manifest, {
      ...fixtureComponentPack.runtime,
      components: { ...fixtureComponentPack.runtime.components, extra: { schemaVersion: 1, component: 'extra' } },
    }), 'RUNTIME_MANIFEST_MISMATCH');
    expectCode(() => validateRuntimeParity(fixtureComponentPack.manifest, {
      ...fixtureComponentPack.runtime,
      components: { ...fixtureComponentPack.runtime.components, prose: { ...fixtureComponentPack.runtime.components.prose, schemaVersion: 2 } },
    }), 'RUNTIME_COMPONENT_VERSION_MISMATCH');
  });

  it('requires an exact 1:1 inline field/adapter match', () => {
    const missing = {
      ...fixtureComponentPack.runtime,
      components: {
        ...fixtureComponentPack.runtime.components,
        container: { ...fixtureComponentPack.runtime.components.container },
      },
    };
    const containerEntry = missing.components.container;
    if (containerEntry === undefined) throw new Error('fixture runtime missing');
    delete (containerEntry as Mutable<typeof containerEntry>).adapters;
    expectCode(() => validateRuntimeParity(fixtureComponentPack.manifest, missing), 'INLINE_EDITOR_MISMATCH');

    const unexpectedManifest = manifest();
    const proseFields = components(unexpectedManifest)[1].fields as Record<string, unknown>[];
    delete proseFields[0].inlineEdit;
    expectCode(() => validateRuntimeParity(unexpectedManifest, fixtureComponentPack.runtime), 'INLINE_EDITOR_MISMATCH');
  });

  it('preserves unknown/version-mismatched nodes opaquely and returns full trusted entries', () => {
    const node = fixtureComponentDocument.root[0];
    if (node === undefined) throw new Error('fixture root missing');
    const mismatched = { ...node, componentVersion: 99 };
    const mismatch = resolveComponentNode(mismatched, fixtureComponentPack);
    expect(mismatch).toEqual({ status: 'opaque', reason: 'component-version-mismatch', node: mismatched });
    expect(mismatch.node).toBe(mismatched);
    const unknown = { ...node, componentId: 'removed-component' };
    expect(resolveComponentNode(unknown, fixtureComponentPack)).toEqual({ status: 'opaque', reason: 'unknown-component', node: unknown });
    expect(resolveComponentNode(node, fixtureComponentPack)).toMatchObject({
      status: 'resolved',
      runtime: { component: 'fixture-container-component', adapters: { render: expect.any(Function), inlineEditor: { field: 'title' } } },
    });
  });
});

type Mutable<T> = { -readonly [TKey in keyof T]: T[TKey] };
