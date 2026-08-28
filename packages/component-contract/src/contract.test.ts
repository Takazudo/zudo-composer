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

describe('component pack v1', () => {
  it('keeps contract, pack, component schema, and document versions distinct', () => {
    expect(fixtureComponentPack.manifest).toMatchObject({
      kind: COMPONENT_PACK_KIND,
      contractVersion: CONTRACT_VERSION,
      packVersion: '3.4.5',
    });
    expect(fixtureComponentPack.manifest.components[0]?.schemaVersion).toBe(2);
    expect(fixtureComponentDocument).toMatchObject({
      kind: COMPONENT_DOCUMENT_KIND,
      documentVersion: DOCUMENT_VERSION,
    });
  });

  it('normalizes omitted defaults, fields, slots, and sources once', () => {
    const definition = defineComponent<{ title: string }, object, 'card'>({
      id: 'card',
      schemaVersion: 1,
      displayName: 'Card',
      props: [{ prop: 'title', kind: 'string' }],
      runtime: {},
    });
    const pack = defineComponentPack({ packId: 'test-pack', packVersion: '1', components: [definition] });
    expect(pack.manifest.components[0]).toMatchObject({ defaults: {}, fields: [], slots: [], sources: [] });
    expect(Object.hasOwn(pack.manifest.components[0] ?? {}, 'runtime')).toBe(false);
  });

  it('round-trips the manifest and document through JSON without changing them', () => {
    const manifestRoundTrip = componentPackManifestSchema.parse(JSON.parse(JSON.stringify(fixtureComponentPack.manifest)));
    const documentRoundTrip = componentDocumentSchema.parse(JSON.parse(JSON.stringify(fixtureComponentDocument)));
    expect(manifestRoundTrip).toEqual(fixtureComponentPack.manifest);
    expect(documentRoundTrip).toEqual(fixtureComponentDocument);
  });

  it('fails an unsupported contract major before inspecting other envelope fields', () => {
    expectCode(() => componentPackManifestSchema.parse({ contractVersion: 2, components: 'bad' }), 'UNSUPPORTED_CONTRACT_VERSION');
  });

  it('reports unsupported document versions independently', () => {
    expectCode(() => componentDocumentSchema.parse({ documentVersion: 2 }), 'UNSUPPORTED_DOCUMENT_VERSION');
  });

  it.each([
    ['component', 'DUPLICATE_COMPONENT_ID', (value: Record<string, unknown>) => { components(value).push(structuredClone(components(value)[0])); }],
    ['prop', 'DUPLICATE_PROP', (value: Record<string, unknown>) => { const list = components(value)[0].props as unknown[]; list.push(structuredClone(list[0])); }],
    ['field', 'DUPLICATE_FIELD_ID', (value: Record<string, unknown>) => { const list = components(value)[0].fields as unknown[]; list.push(structuredClone(list[0])); }],
    ['slot', 'DUPLICATE_SLOT_ID', (value: Record<string, unknown>) => { const list = components(value)[0].slots as unknown[]; list.push(structuredClone(list[0])); }],
    ['source', 'DUPLICATE_SOURCE_ID', (value: Record<string, unknown>) => { const list = components(value)[0].sources as unknown[]; list.push(structuredClone(list[0])); }],
    ['accepts target', 'DUPLICATE_ACCEPTS', (value: Record<string, unknown>) => { const accepts = ((components(value)[0].slots as Record<string, unknown>[])[0].accepts as string[]); accepts.push(accepts[0]); }],
  ] as const)('rejects duplicate %s identities', (_label, code, mutate) => {
    const value = manifest();
    mutate(value);
    expectCode(() => componentPackManifestSchema.parse(value), code);
  });

  it('rejects unresolved slot accepts targets', () => {
    const value = manifest();
    ((components(value)[0].slots as Record<string, unknown>[])[0].accepts as string[]).push('missing');
    expectCode(() => componentPackManifestSchema.parse(value), 'UNRESOLVED_ACCEPTS');
  });

  it.each(['id', 'props', 'slots', '__proto__', 'constructor'])('rejects reserved persisted prop key %s', (key) => {
    const value = manifest();
    (components(value)[0].props as unknown[]).push({ prop: key, kind: 'string' });
    expectCode(() => componentPackManifestSchema.parse(value), 'RESERVED_KEY');
  });

  it.each([
    './private',
    '/absolute/private',
    'https://example.test/ui',
    '@fixture/ui/src/Button',
    '#internal',
  ])('rejects non-public import %s', (module) => {
    const value = manifest();
    ((components(value)[0].sources as Record<string, unknown>[])[0]).module = module;
    expectCode(() => componentPackManifestSchema.parse(value), 'INVALID_PUBLIC_IMPORT');
  });

  it.each(['default export', 'foo-bar', '2Button', 'foo.bar'])('rejects invalid public export %s', (exportName) => {
    const value = manifest();
    ((components(value)[0].sources as Record<string, unknown>[])[0]).export = exportName;
    expectCode(() => componentPackManifestSchema.parse(value), 'INVALID_PUBLIC_EXPORT');
  });

  it('rejects inline adapter APIs with a specific diagnostic', () => {
    const value = manifest();
    ((components(value)[0].sources as Record<string, unknown>[])[0]).adapter = () => 'unsafe';
    expectCode(() => componentPackManifestSchema.parse(value), 'INLINE_ADAPTER_NOT_ALLOWED');
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, undefined, 1n, () => null, new Date()])('rejects non-JSON field data %#', (badValue) => {
    const value = structuredClone(fixtureComponentDocument) as unknown as Record<string, unknown>;
    const root = (value.roots as Record<string, unknown>[])[0];
    (root.fields as Record<string, unknown>).bad = badValue;
    expectCode(() => componentDocumentSchema.parse(value), 'INVALID_JSON_VALUE');
  });

  it('rejects cyclic JSON data', () => {
    const value = structuredClone(fixtureComponentDocument) as unknown as Record<string, unknown>;
    const root = (value.roots as Record<string, unknown>[])[0];
    (root.fields as Record<string, unknown>).self = root.fields;
    expectCode(() => componentDocumentSchema.parse(value), 'INVALID_JSON_VALUE');
  });

  it('rejects JSON structures that serialization would silently change', () => {
    const sparse = Array.from({ length: 1 }) as unknown[];
    delete sparse[0];
    const sparseDocument = structuredClone(fixtureComponentDocument) as unknown as Record<string, unknown>;
    const sparseRoot = (sparseDocument.roots as Record<string, unknown>[])[0];
    (sparseRoot.fields as Record<string, unknown>).sparse = sparse;
    expectCode(() => componentDocumentSchema.parse(sparseDocument), 'INVALID_JSON_VALUE');

    const hiddenDocument = structuredClone(fixtureComponentDocument) as unknown as Record<string, unknown>;
    const hiddenRoot = (hiddenDocument.roots as Record<string, unknown>[])[0];
    Object.defineProperty(hiddenRoot.fields, 'hidden', { value: 'lost', enumerable: false });
    expectCode(() => componentDocumentSchema.parse(hiddenDocument), 'INVALID_JSON_VALUE');
  });

  it('enforces scalar persisted props', () => {
    const value = structuredClone(fixtureComponentDocument) as unknown as Record<string, unknown>;
    const root = (value.roots as Record<string, unknown>[])[0];
    (root.props as Record<string, unknown>).tone = ['not', 'scalar'];
    expectCode(() => componentDocumentSchema.parse(value), 'INVALID_VALUE');
  });

  it('is strict about unknown keys', () => {
    const value = manifest();
    components(value)[0].allowedParents = ['container'];
    expectCode(() => componentPackManifestSchema.parse(value), 'UNKNOWN_KEY');
  });

  it('does not silently discard excluded author APIs during manifest projection', () => {
    const definition = {
      id: 'legacy',
      schemaVersion: 1,
      displayName: 'Legacy',
      props: [],
      runtime: {},
      allowedParents: ['container'],
    };
    expectCode(
      () => defineComponentPack({ packId: 'test-pack', packVersion: '1', components: [definition] }),
      'UNKNOWN_KEY',
    );
  });
});

describe('trusted runtime projection', () => {
  it('strictly validates runtime registry metadata without inspecting trusted code', () => {
    const runtime = () => 'trusted';
    const parsed = componentRuntimeRegistrySchema.parse({
      packId: 'pack',
      packVersion: '1',
      components: { card: { schemaVersion: 1, runtime } },
    });
    expect(parsed.components.card?.runtime).toBe(runtime);
    expectCode(
      () => componentRuntimeRegistrySchema.parse({
        packId: 'pack',
        packVersion: '1',
        components: { card: { schemaVersion: 1, runtime, adapter: () => null } },
      }),
      'INLINE_ADAPTER_NOT_ALLOWED',
    );
  });

  it('keeps the runtime and serializable manifest in exact 1:1 parity', () => {
    expect(Object.keys(fixtureComponentPack.runtime.components).sort()).toEqual(
      fixtureComponentPack.manifest.components.map((component) => component.id).sort(),
    );
    expect(validateRuntimeParity(fixtureComponentPack.manifest, fixtureComponentPack.runtime)).toEqual(fixtureComponentPack);
  });

  it('diagnoses missing runtime entries explicitly', () => {
    const componentsWithoutText = { ...fixtureComponentPack.runtime.components };
    delete componentsWithoutText.text;
    expectCode(
      () => validateRuntimeParity(fixtureComponentPack.manifest, { ...fixtureComponentPack.runtime, components: componentsWithoutText }),
      'MISSING_RUNTIME_ENTRY',
    );
  });

  it('rejects runtime extras and component schema-version drift', () => {
    expectCode(
      () => validateRuntimeParity(fixtureComponentPack.manifest, {
        ...fixtureComponentPack.runtime,
        components: { ...fixtureComponentPack.runtime.components, extra: { schemaVersion: 1, runtime: 'extra' } },
      }),
      'RUNTIME_MANIFEST_MISMATCH',
    );
    expectCode(
      () => validateRuntimeParity(fixtureComponentPack.manifest, {
        ...fixtureComponentPack.runtime,
        components: {
          ...fixtureComponentPack.runtime.components,
          text: { ...fixtureComponentPack.runtime.components.text, schemaVersion: 2 },
        },
      }),
      'RUNTIME_COMPONENT_VERSION_MISMATCH',
    );
  });

  it('preserves version-mismatched and unknown nodes opaquely for recovery', () => {
    const node = fixtureComponentDocument.roots[0];
    if (node === undefined) throw new Error('fixture root missing');
    const mismatched = { ...node, componentVersion: 99 };
    const mismatchResolution = resolveComponentNode(mismatched, fixtureComponentPack);
    expect(mismatchResolution).toEqual({ status: 'opaque', reason: 'component-version-mismatch', node: mismatched });
    expect(mismatchResolution.node).toBe(mismatched);
    const unknown = { ...node, componentId: 'removed-component' };
    expect(resolveComponentNode(unknown, fixtureComponentPack)).toEqual({ status: 'opaque', reason: 'unknown-component', node: unknown });
  });

  it('returns trusted runtime values only after identity and version resolution', () => {
    const node = fixtureComponentDocument.roots[0];
    if (node === undefined) throw new Error('fixture root missing');
    expect(resolveComponentNode(node, fixtureComponentPack)).toMatchObject({ status: 'resolved', runtime: 'fixture-container-runtime' });
  });
});
