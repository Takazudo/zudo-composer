import type { Story, StoryMeta } from "@takazudo/zudo-sg/stories";
import { Callout, ProseP, type CalloutProps } from "@zudo-composer/ui";
import {
  calloutComposer,
  calloutDisplay,
} from "@zudo-composer/ui/src/cards/callout/callout.composer.tsx";

const meta: StoryMeta = {
  ...calloutDisplay,
  category: "Cards",
  usage: `import { Callout, ProseP } from "@zudo-composer/ui";

<Callout title="Note">
  <ProseP>Keep this detail in mind while reviewing the page.</ProseP>
</Callout>`,
};
export default meta;

function CalloutBody() {
  return <ProseP>Keep this detail in mind while reviewing the page.</ProseP>;
}

export const Defaults: Story = {
  name: "Defaults",
  render: () => (
    <Callout {...calloutComposer.defaults}>
      <CalloutBody />
    </Callout>
  ),
};

export const Note: Story = {
  name: "Note",
  render: () => (
    <Callout {...calloutComposer.defaults} tone="note">
      <CalloutBody />
    </Callout>
  ),
};

export const Muted: Story = {
  name: "Muted",
  render: () => (
    <Callout {...calloutComposer.defaults} tone="muted">
      <CalloutBody />
    </Callout>
  ),
};

export const Interactive: Story<CalloutProps> = {
  name: "Interactive",
  render: (args) => (
    <Callout {...calloutComposer.defaults} {...args}>
      <CalloutBody />
    </Callout>
  ),
  controls: [
    {
      type: "select",
      prop: "tone",
      label: "Tone",
      options: ["note", "muted"],
      defaultValue: "note",
    },
    { type: "text", prop: "title", label: "Title", defaultValue: "Note" },
  ],
};
