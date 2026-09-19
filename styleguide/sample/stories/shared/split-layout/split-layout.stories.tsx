import type { Story, StoryMeta } from "@takazudo/zudo-sg/stories";
import { Card, ProseP, SplitLayout } from "@zudo-composer/ui";
import {
  splitLayoutComposer,
  splitLayoutDisplay,
} from "@zudo-composer/ui/src/shared/split-layout/split-layout.composer.tsx";

const meta: StoryMeta = {
  ...splitLayoutDisplay,
  category: "Shared",
  usage: `import { SplitLayout } from "@zudo-composer/ui";

<SplitLayout
  left={<aside>Supporting content</aside>}
  right={<main>Primary content</main>}
/>`,
};
export default meta;

function DemoPanes() {
  return {
    left: (
      <Card title="Supporting details" variant="muted">
        <ProseP>Secondary information stays in its own pane.</ProseP>
      </Card>
    ),
    right: (
      <Card title="Primary content">
        <ProseP>Main content gets the larger reading area.</ProseP>
      </Card>
    ),
  };
}

export const Defaults: Story = {
  name: "Defaults",
  render: () => <SplitLayout {...splitLayoutComposer.defaults} {...DemoPanes()} />,
};

export const Ratio50_50: Story = {
  name: "Ratio 50/50",
  render: () => <SplitLayout {...splitLayoutComposer.defaults} ratio="50/50" {...DemoPanes()} />,
};

export const Ratio40_60: Story = {
  name: "Ratio 40/60",
  render: () => <SplitLayout {...splitLayoutComposer.defaults} ratio="40/60" {...DemoPanes()} />,
};

export const Ratio60_40: Story = {
  name: "Ratio 60/40",
  render: () => <SplitLayout {...splitLayoutComposer.defaults} ratio="60/40" {...DemoPanes()} />,
};

export const Ratio33_67: Story = {
  name: "Ratio 33/67",
  render: () => <SplitLayout {...splitLayoutComposer.defaults} ratio="33/67" {...DemoPanes()} />,
};

export const Ratio67_33: Story = {
  name: "Ratio 67/33",
  render: () => <SplitLayout {...splitLayoutComposer.defaults} ratio="67/33" {...DemoPanes()} />,
};

export const GapSm: Story = {
  name: "Gap sm",
  render: () => <SplitLayout {...splitLayoutComposer.defaults} gap="sm" {...DemoPanes()} />,
};

export const GapMd: Story = {
  name: "Gap md",
  render: () => <SplitLayout {...splitLayoutComposer.defaults} gap="md" {...DemoPanes()} />,
};

export const GapLg: Story = {
  name: "Gap lg",
  render: () => <SplitLayout {...splitLayoutComposer.defaults} gap="lg" {...DemoPanes()} />,
};
