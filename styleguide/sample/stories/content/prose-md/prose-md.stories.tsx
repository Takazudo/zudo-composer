import type { Story, StoryMeta } from "@takazudo/zudo-sg/stories";
import { ProseMd, type ProseMdProps } from "@zudo-composer/ui";
import {
  proseMdComposer,
  proseMdDisplay,
} from "@zudo-composer/ui/src/content/prose-md/prose-md.composer.tsx";

const meta: StoryMeta = {
  ...proseMdDisplay,
  category: "Content",
  usage: `import { ProseMd } from "@zudo-composer/ui";

<ProseMd markdown={"## Getting started\\n\\nRender **markdown** from a string."} />`,
};
export default meta;

export const Defaults: Story = {
  name: "Defaults",
  render: () => <ProseMd {...proseMdComposer.defaults} />,
};

export const Interactive: Story<ProseMdProps> = {
  name: "Interactive",
  render: (args) => <ProseMd {...proseMdComposer.defaults} {...args} />,
  controls: [
    {
      type: "text",
      prop: "markdown",
      label: "Markdown",
      defaultValue: proseMdComposer.defaults.markdown,
    },
  ],
};
