import { defineComponent, defineComponentPack } from '@zudo-composer/component-contract';

interface ExampleProps {
  title?: string;
  tone?: 'neutral' | 'accent';
  count?: number;
  enabled?: boolean;
  config?: { size: number };
  mixedText?: string | { raw: string };
  mixedColor?: string | { token: string };
  mixedScalar?: string | number;
  impossible?: never;
  children?: unknown;
}

const ExampleComponent = (props: ExampleProps) => props.title;

const base = {
  id: 'example',
  schemaVersion: 1,
  title: 'Example',
  category: 'Fixture',
  description: '',
  source: { module: '@fixture/example', exportKind: 'named' as const, exportName: 'Example' },
};

defineComponent<ExampleProps>()(ExampleComponent, {
  ...base,
  defaults: {
    title: 'Hello',
    tone: 'neutral',
    count: 2,
    enabled: true,
    config: { size: 1 },
    mixedText: 'Text',
    mixedColor: '#336699',
    mixedScalar: 'Text',
  },
  fields: [
    { kind: 'text', prop: 'title', label: 'Title' },
    { kind: 'select', prop: 'tone', label: 'Tone', options: ['neutral', 'accent'] },
    { kind: 'number', prop: 'count', label: 'Count' },
    { kind: 'boolean', prop: 'enabled', label: 'Enabled' },
    { kind: 'text', prop: 'mixedText', label: 'Mixed text' },
    { kind: 'color', prop: 'mixedColor', label: 'Mixed color-capable value' },
    { kind: 'text', prop: 'mixedScalar', label: 'Mixed scalar text' },
  ],
  slots: [{ id: 'content', prop: 'children', label: 'Content', cardinality: 'many' }],
  adapters: { inlineEditor: { field: 'title', resolveElement: (root: unknown) => root } },
});

// @ts-expect-error A never-valued prop exposes no editable scalar field kind.
defineComponent<ExampleProps>()(ExampleComponent, {
  ...base,
  fields: [
    { kind: 'boolean', prop: 'impossible', label: 'Impossible' },
  ],
});

const firstRuntime = defineComponent<ExampleProps>()((props: ExampleProps) => props.title ?? '', {
  ...base,
  staticProps: [{ prop: 'title' }],
});
const secondRuntime = defineComponent<{ active: boolean }>()((props: { active: boolean }) => props.active, {
  ...base,
  id: 'second',
  source: { ...base.source, module: '@fixture/second', exportName: 'Second' },
  staticProps: [{ prop: 'active' }],
});

// @ts-expect-error Required props cannot be left entirely outside the authoring contract.
defineComponent<{ title: string }>()((props: { title: string }) => props.title, { ...base });
// @ts-expect-error An optional prop does not classify the required prop.
defineComponent<{ title: string; note?: string }>()((props: { title: string; note?: string }) => props.title, {
  ...base,
  fields: [{ kind: 'text', prop: 'note', label: 'Note' }],
});
const heterogeneousPack = defineComponentPack({
  packId: 'typed-pack',
  packVersion: '1',
  components: [firstRuntime, secondRuntime],
});
const heterogeneousComponent = heterogeneousPack.runtime.components.example?.component;
void heterogeneousComponent;

interface TotalProps {
  defaulted: string;
  edited: number;
  content: unknown;
  applicationOwned: { readonly token: string };
}

const TotalComponent = (_props: TotalProps) => null;

defineComponent<TotalProps>()(TotalComponent, {
  ...base,
  defaults: { defaulted: 'ready' },
  fields: [{ kind: 'number', prop: 'edited', label: 'Edited' }],
  slots: [{ id: 'content', prop: 'content', label: 'Content', cardinality: 'many' }],
  staticProps: [{ prop: 'applicationOwned' }],
});

// @ts-expect-error Every required prop must be classified, not merely one of them.
defineComponent<{ first: string; second: string }>()((_props: { first: string; second: string }) => null, {
  ...base,
  defaults: { first: 'classified' },
});

const OtherComponent = (_props: { count: number }) => null;
// @ts-expect-error The declared authoring props must belong to the registered component.
defineComponent<{ title: string }>()(OtherComponent, { ...base, defaults: { title: 'wrong component' } });

// @ts-expect-error The props generic cannot be omitted by passing a definition directly.
defineComponent({ ...base, fields: [{ kind: 'text', prop: 'missing', label: 'Missing' }] });

// @ts-expect-error A string prop cannot receive rendered slot children.
defineComponent<ExampleProps>()(ExampleComponent, {
  ...base,
  slots: [{ id: 'bad-slot', prop: 'title', label: 'Bad slot', cardinality: 'single' }],
});

defineComponent<ExampleProps>()(ExampleComponent, {
  ...base,
  staticProps: [{ prop: 'config', reason: 'Owned by application code.' }],
});

// @ts-expect-error Static declarations must use a real component prop.
defineComponent<ExampleProps>()(ExampleComponent, {
  ...base,
  staticProps: [
    { prop: 'missing' },
  ],
});

// @ts-expect-error Defaults must use a real component prop.
defineComponent<ExampleProps>()(ExampleComponent, {
  ...base,
  defaults: {
    missing: 'nope',
  },
});

// @ts-expect-error Number fields require the whole non-null prop domain to be numeric.
defineComponent<ExampleProps>()(ExampleComponent, {
  ...base,
  fields: [
    { kind: 'number', prop: 'mixedScalar', label: 'Wrong mixed number' },
  ],
});

// @ts-expect-error Select fields require the whole non-null prop domain to be string-valued.
defineComponent<ExampleProps>()(ExampleComponent, {
  ...base,
  fields: [
    { kind: 'select', prop: 'mixedText', label: 'Wrong mixed select', options: ['Text'] },
  ],
});

// @ts-expect-error Number fields require a wholly number-valued prop.
defineComponent<ExampleProps>()(ExampleComponent, {
  ...base,
  fields: [
    { kind: 'number', prop: 'title', label: 'Wrong number field' },
  ],
});

// @ts-expect-error Boolean fields require a wholly boolean-valued prop.
defineComponent<ExampleProps>()(ExampleComponent, {
  ...base,
  fields: [
    { kind: 'boolean', prop: 'count', label: 'Wrong boolean field' },
  ],
});

// @ts-expect-error Text fields require a string-capable prop.
defineComponent<ExampleProps>()(ExampleComponent, {
  ...base,
  fields: [
    { kind: 'text', prop: 'count', label: 'Wrong text field' },
  ],
});

// @ts-expect-error Color fields require a string-capable prop.
defineComponent<ExampleProps>()(ExampleComponent, {
  ...base,
  fields: [
    { kind: 'color', prop: 'enabled', label: 'Wrong color field' },
  ],
});

// @ts-expect-error Select fields require a string-capable prop.
defineComponent<ExampleProps>()(ExampleComponent, {
  ...base,
  fields: [
    { kind: 'select', prop: 'count', label: 'Wrong select field', options: ['2'] },
  ],
});

// @ts-expect-error Default values retain the real prop's value type.
defineComponent<ExampleProps>()(ExampleComponent, {
  ...base,
  defaults: {
    count: 'two',
  },
});

// @ts-expect-error Editable fields must map to a real component prop.
defineComponent<ExampleProps>()(ExampleComponent, {
  ...base,
  fields: [
    { kind: 'text', prop: 'missing', label: 'Missing' },
  ],
});

// @ts-expect-error Select options narrow to the real string-literal prop domain.
defineComponent<ExampleProps>()(ExampleComponent, {
  ...base,
  fields: [
    { kind: 'select', prop: 'tone', label: 'Tone', options: ['former-value'] },
  ],
});

// @ts-expect-error Structural slots must map to a real component prop.
defineComponent<ExampleProps>()(ExampleComponent, {
  ...base,
  slots: [
    { id: 'content', prop: 'missing', label: 'Content', cardinality: 'many' },
  ],
});

// @ts-expect-error Inline-editor targets are real component props.
defineComponent<ExampleProps>()(ExampleComponent, {
  ...base,
  adapters: {
    inlineEditor: {
      field: 'missing',
      resolveElement: (root: unknown) => root,
    },
  },
});
