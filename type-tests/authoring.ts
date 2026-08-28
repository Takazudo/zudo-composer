import { defineComponent, defineComponentPack } from '@zudo-composer/component-contract';

interface ExampleProps {
  title: string;
  tone: 'neutral' | 'accent';
  count: number;
  config: { size: number };
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
  defaults: { title: 'Hello', tone: 'neutral', count: 2, config: { size: 1 } },
  fields: [
    { kind: 'text', prop: 'title', label: 'Title' },
    { kind: 'select', prop: 'tone', label: 'Tone', options: ['neutral', 'accent'] },
    { kind: 'number', prop: 'count', label: 'Count' },
  ],
  slots: [{ id: 'content', prop: 'children', label: 'Content', cardinality: 'many' }],
  adapters: { inlineEditor: { field: 'title', resolveElement: (root) => root } },
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

defineComponent<ExampleProps>({
  ...base,
  defaults: {
    // @ts-expect-error Defaults must use a real component prop.
    missing: 'nope',
  },
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
