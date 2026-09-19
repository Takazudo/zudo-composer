import type { Story, StoryMeta } from "@takazudo/zudo-sg/stories";
import { ProseMd } from "@zudo-composer/ui";
import {
  proseMdComposer,
  proseMdDisplay,
} from "@zudo-composer/ui/src/content/prose-md/prose-md.composer.tsx";

const meta: StoryMeta = {
  ...proseMdDisplay,
  usage: `import { ProseMd } from "@zudo-composer/ui";

<ProseMd markdown={"## Getting started\\n\\nRender **markdown** from a string."} />`,
};
export default meta;

export const Defaults: Story = {
  name: "Defaults",
  render: () => <ProseMd {...proseMdComposer.defaults} />,
};
