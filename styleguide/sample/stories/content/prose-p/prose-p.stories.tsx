import type { Story, StoryMeta } from "@takazudo/zudo-sg/stories";
import { ProseP } from "@zudo-composer/ui";
import {
  prosePComposer,
  prosePDisplay,
} from "@zudo-composer/ui/src/content/prose-p/prose-p.composer.tsx";

const meta: StoryMeta = {
  ...prosePDisplay,
  category: "Content",
  usage: `import { ProseP } from "@zudo-composer/ui";

<ProseP>Body copy.</ProseP>`,
};
export default meta;

type ProsePStoryProps = { children?: string };

const prosePDefaults: ProsePStoryProps = {
  children: prosePComposer.defaults.children,
};

export const Defaults: Story = {
  name: "Defaults",
  render: () => <ProseP {...prosePDefaults} />,
};

export const Interactive: Story<ProsePStoryProps> = {
  name: "Interactive",
  render: (args) => <ProseP {...prosePDefaults} {...args} />,
  controls: [{ type: "text", prop: "children", label: "Text", defaultValue: "Body copy." }],
};
