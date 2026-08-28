import { defineComponent, defineComponentPack } from './validation.js';
import {
  COMPONENT_DOCUMENT_KIND,
  DOCUMENT_VERSION,
  type ComponentDocument,
} from './types.js';

interface FixtureContainerProps {
  tone: string;
  padded: boolean;
}

interface FixtureTextProps {
  text: string;
}

const fixtureContainer = defineComponent<FixtureContainerProps, string, 'container', 'heading', 'content', 'component'>({
  id: 'container',
  schemaVersion: 2,
  displayName: 'Container',
  props: [
    { prop: 'tone', kind: 'string' },
    { prop: 'padded', kind: 'boolean' },
  ],
  defaults: { tone: 'neutral', padded: true },
  fields: [{ id: 'heading' }],
  slots: [{ id: 'content', accepts: ['container', 'text'] }],
  sources: [{ id: 'component', module: '@fixture/ui', export: 'Container' }],
  runtime: 'fixture-container-runtime',
});

const fixtureText = defineComponent<FixtureTextProps, string, 'text', 'body', never, 'component'>({
  id: 'text',
  schemaVersion: 1,
  displayName: 'Text',
  props: [{ prop: 'text', kind: 'string', required: true }],
  fields: [{ id: 'body' }],
  sources: [{ id: 'component', module: '@fixture/ui', export: 'Text' }],
  runtime: 'fixture-text-runtime',
});

/** Stable in-package conformance fixture; applications must not depend on it as provider data. */
export const fixtureComponentPack = defineComponentPack({
  packId: '@fixture/component-pack',
  packVersion: '3.4.5',
  components: [fixtureContainer, fixtureText],
});

export const fixtureComponentDocument: ComponentDocument = {
  kind: COMPONENT_DOCUMENT_KIND,
  documentVersion: DOCUMENT_VERSION,
  packId: fixtureComponentPack.manifest.packId,
  packVersion: fixtureComponentPack.manifest.packVersion,
  roots: [
    {
      id: 'root',
      componentId: 'container',
      componentVersion: 2,
      props: { tone: 'neutral', padded: true },
      fields: { heading: 'Fixture' },
      slots: {
        content: [
          {
            id: 'child',
            componentId: 'text',
            componentVersion: 1,
            props: { text: 'Hello' },
            fields: { body: [{ type: 'text', value: 'Hello' }] },
            slots: {},
          },
        ],
      },
    },
  ],
};
