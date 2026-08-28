import { defineComponent, defineComponentPack } from './validation.js';
import { COMPONENT_DOCUMENT_KIND, DOCUMENT_VERSION, type ComponentDocument } from './types.js';

interface FixtureElement {
  readonly name: string;
}

interface ContainerProps {
  title: string;
  layout: 'stack' | 'grid';
  enabled: boolean;
  columns: number;
  accent: string;
  children?: unknown;
  aside?: unknown;
}

interface ProseProps {
  markdown: string;
}

interface BadgeProps {
  label: string;
  tone: 'neutral' | 'positive';
}

const container = defineComponent<ContainerProps, string, string, FixtureElement, 'container'>({
  id: 'container',
  schemaVersion: 2,
  title: 'Container',
  category: 'Layout',
  description: 'A representative structural component.',
  source: { module: '@fixture/ui', exportKind: 'named', exportName: 'Container' },
  defaults: {
    title: 'Section',
    layout: 'stack',
    enabled: true,
    columns: 2,
    accent: '#336699',
  },
  fields: [
    { kind: 'text', prop: 'title', label: 'Title', required: true, inlineEdit: { multiline: false } },
    { kind: 'select', prop: 'layout', label: 'Layout', options: ['stack', 'grid'] },
    { kind: 'boolean', prop: 'enabled', label: 'Enabled' },
    { kind: 'number', prop: 'columns', label: 'Columns', min: 1, max: 4, step: 1 },
    { kind: 'color', prop: 'accent', label: 'Accent' },
  ],
  slots: [
    { id: 'content', prop: 'children', label: 'Content', accepts: ['prose', 'badge'], cardinality: 'many' },
    { id: 'aside', prop: 'aside', label: 'Aside', accepts: ['badge'], cardinality: 'single' },
  ],
  component: 'fixture-container-component',
  adapters: {
    render: (props) => `container:${props.title ?? ''}`,
    inlineEditor: { field: 'title', resolveElement: (root) => root },
  },
});

const prose = defineComponent<ProseProps, string, string, FixtureElement, 'prose'>({
  id: 'prose',
  schemaVersion: 1,
  title: 'Prose',
  category: 'Content',
  description: 'Markdown source text.',
  source: { module: '@fixture/ui/content', exportKind: 'default', exportName: 'Prose', localName: 'FixtureProse' },
  defaults: { markdown: 'Hello' },
  fields: [
    {
      kind: 'text',
      prop: 'markdown',
      label: 'Markdown',
      inlineEdit: { multiline: true, mode: 'markdown-source' },
    },
  ],
  component: 'fixture-prose-component',
  adapters: {
    inlineEditor: { field: 'markdown', resolveElement: (root) => root },
  },
});

const badge = defineComponent<BadgeProps, string, string, FixtureElement, 'badge'>({
  id: 'badge',
  schemaVersion: 1,
  title: 'Badge',
  category: 'Content',
  description: 'A leaf component.',
  source: { module: '@fixture/ui/badge', exportKind: 'named', exportName: 'Badge' },
  defaults: { label: 'New', tone: 'neutral' },
  fields: [
    { kind: 'text', prop: 'label', label: 'Label' },
    { kind: 'select', prop: 'tone', label: 'Tone', options: ['neutral', 'positive'] },
  ],
  component: 'fixture-badge-component',
  adapters: { render: (props) => `badge:${props.label ?? ''}` },
});

/** Stable in-package conformance fixture; applications must not use it as provider data. */
export const fixtureComponentPack = defineComponentPack({
  packId: '@fixture/component-pack',
  packVersion: '3.4.5',
  components: [container, prose, badge],
});

export const fixtureComponentDocument: ComponentDocument = {
  kind: COMPONENT_DOCUMENT_KIND,
  documentVersion: DOCUMENT_VERSION,
  root: [
    {
      id: 'root',
      componentId: 'container',
      componentVersion: 2,
      props: {
        title: 'Fixture',
        layout: 'stack',
        enabled: true,
        columns: 2,
        accent: '#336699',
        analytics: { tags: ['fixture'] },
      },
      slots: {
        content: [
          {
            id: 'child',
            componentId: 'prose',
            componentVersion: 1,
            props: { markdown: '**Hello**' },
            slots: {},
          },
        ],
        aside: [],
      },
    },
  ],
};
