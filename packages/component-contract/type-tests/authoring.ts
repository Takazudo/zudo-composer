import { defineComponent, defineComponentPack } from '@zudo-composer/component-contract';

interface ExampleProps {
  title: string;
  tone: 'neutral' | 'accent';
  count: number;
  enabled: boolean;
  config: { size: number };
  mixedText: string | { raw: string };
  mixedColor: string | { token: string };
  mixedScalar: string | number;
  impossible: never;
  children?: unknown;
}

const base = {
  id: 'example',
  schemaVersion: 1,
  title: 'Example',
  category: 'Fixture',
  description: '',
  source: { module: '@fixture/example', exportKind: 'named' as const, exportName: 'Example' },
  component: {},
};

defineComponent<ExampleProps>({
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
  adapters: { inlineEditor: { field: 'title', resolveElement: (root) => root } },
});

defineComponent<ExampleProps>({
  ...base,
  fields: [
    // @ts-expect-error A never-valued prop exposes no editable scalar field kind.
    { kind: 'boolean', prop: 'impossible', label: 'Impossible' },
  ],
});

const firstRuntime = defineComponent<ExampleProps, (props: ExampleProps) => string>({
  ...base,
  component: (props) => props.title,
});
const secondRuntime = defineComponent<{ active: boolean }, (props: { active: boolean }) => boolean>({
  ...base,
  id: 'second',
  source: { ...base.source, module: '@fixture/second', exportName: 'Second' },
  component: (props) => props.active,
});
const heterogeneousPack = defineComponentPack({
  packId: 'typed-pack',
  packVersion: '1',
  components: [firstRuntime, secondRuntime],
});
const heterogeneousComponent = heterogeneousPack.runtime.components.example?.component;
void heterogeneousComponent;

defineComponent<Record<string, unknown>>({
  ...base,
  fields: [
    { kind: 'text', prop: 'text', label: 'Text' },
    { kind: 'select', prop: 'choice', label: 'Choice', options: ['a', 'b'] },
    { kind: 'boolean', prop: 'enabled', label: 'Enabled' },
    { kind: 'number', prop: 'count', label: 'Count' },
    { kind: 'color', prop: 'color', label: 'Color' },
  ],
});

defineComponent<ExampleProps>({
  ...base,
  defaults: {
    // @ts-expect-error Defaults must use a real component prop.
    missing: 'nope',
  },
});

defineComponent<ExampleProps>({
  ...base,
  fields: [
    // @ts-expect-error Number fields require the whole non-null prop domain to be numeric.
    { kind: 'number', prop: 'mixedScalar', label: 'Wrong mixed number' },
  ],
});

defineComponent<ExampleProps>({
  ...base,
  fields: [
    // @ts-expect-error Select fields require the whole non-null prop domain to be string-valued.
    { kind: 'select', prop: 'mixedText', label: 'Wrong mixed select', options: ['Text'] },
  ],
});

defineComponent<ExampleProps>({
  ...base,
  fields: [
    // @ts-expect-error Number fields require a wholly number-valued prop.
    { kind: 'number', prop: 'title', label: 'Wrong number field' },
  ],
});

defineComponent<ExampleProps>({
  ...base,
  fields: [
    // @ts-expect-error Boolean fields require a wholly boolean-valued prop.
    { kind: 'boolean', prop: 'count', label: 'Wrong boolean field' },
  ],
});

defineComponent<ExampleProps>({
  ...base,
  fields: [
    // @ts-expect-error Text fields require a string-capable prop.
    { kind: 'text', prop: 'count', label: 'Wrong text field' },
  ],
});

defineComponent<ExampleProps>({
  ...base,
  fields: [
    // @ts-expect-error Color fields require a string-capable prop.
    { kind: 'color', prop: 'enabled', label: 'Wrong color field' },
  ],
});

defineComponent<ExampleProps>({
  ...base,
  fields: [
    // @ts-expect-error Select fields require a string-capable prop.
    { kind: 'select', prop: 'count', label: 'Wrong select field', options: ['2'] },
  ],
});

defineComponent<ExampleProps>({
  ...base,
  defaults: {
    // @ts-expect-error Default values retain the real prop's value type.
    count: 'two',
  },
});

defineComponent<ExampleProps>({
  ...base,
  fields: [
    // @ts-expect-error Editable fields must map to a real component prop.
    { kind: 'text', prop: 'missing', label: 'Missing' },
  ],
});

defineComponent<ExampleProps>({
  ...base,
  fields: [
    // @ts-expect-error Select options narrow to the real string-literal prop domain.
    { kind: 'select', prop: 'tone', label: 'Tone', options: ['former-value'] },
  ],
});

defineComponent<ExampleProps>({
  ...base,
  slots: [
    // @ts-expect-error Structural slots must map to a real component prop.
    { id: 'content', prop: 'missing', label: 'Content', cardinality: 'many' },
  ],
});

defineComponent<ExampleProps>({
  ...base,
  adapters: {
    inlineEditor: {
      // @ts-expect-error Inline-editor targets are real component props.
      field: 'missing',
      resolveElement: (root) => root,
    },
  },
});
