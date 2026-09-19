import type { Story, StoryMeta } from "@takazudo/zudo-sg/stories";
import { AutoGrid, Card, ProseP } from "@zudo-composer/ui";
import {
  autoGridComposer,
  autoGridDisplay,
} from "@zudo-composer/ui/src/shared/auto-grid/auto-grid.composer.tsx";

const meta: StoryMeta = {
  ...autoGridDisplay,
  category: "Shared",
  usage: `import { AutoGrid, Card } from "@zudo-composer/ui";

<AutoGrid>
  <Card title="First item">A short description.</Card>
  <Card title="Second item">Another short description.</Card>
</AutoGrid>`,
};
export default meta;

function DemoCards() {
  return (
    <>
      <Card title="First item">
        <ProseP>Short supporting copy for the first item.</ProseP>
      </Card>
      <Card title="Second item">
        <ProseP>Short supporting copy for the second item.</ProseP>
      </Card>
      <Card title="Third item">
        <ProseP>Short supporting copy for the third item.</ProseP>
      </Card>
    </>
  );
}

export const Defaults: Story = {
  name: "Defaults",
  render: () => (
    <AutoGrid {...autoGridComposer.defaults}>
      <DemoCards />
    </AutoGrid>
  ),
};

export const Min11rem: Story = {
  name: "Min 11rem",
  render: () => (
    <AutoGrid {...autoGridComposer.defaults} min="11rem">
      <DemoCards />
    </AutoGrid>
  ),
};

export const Min13rem: Story = {
  name: "Min 13rem",
  render: () => (
    <AutoGrid {...autoGridComposer.defaults} min="13rem">
      <DemoCards />
    </AutoGrid>
  ),
};

export const Min14rem: Story = {
  name: "Min 14rem",
  render: () => (
    <AutoGrid {...autoGridComposer.defaults} min="14rem">
      <DemoCards />
    </AutoGrid>
  ),
};

export const Min15rem: Story = {
  name: "Min 15rem",
  render: () => (
    <AutoGrid {...autoGridComposer.defaults} min="15rem">
      <DemoCards />
    </AutoGrid>
  ),
};

export const Min16rem: Story = {
  name: "Min 16rem",
  render: () => (
    <AutoGrid {...autoGridComposer.defaults} min="16rem">
      <DemoCards />
    </AutoGrid>
  ),
};

export const Min18rem: Story = {
  name: "Min 18rem",
  render: () => (
    <AutoGrid {...autoGridComposer.defaults} min="18rem">
      <DemoCards />
    </AutoGrid>
  ),
};

export const GapSm: Story = {
  name: "Gap sm",
  render: () => (
    <AutoGrid {...autoGridComposer.defaults} gap="sm">
      <DemoCards />
    </AutoGrid>
  ),
};

export const GapMd: Story = {
  name: "Gap md",
  render: () => (
    <AutoGrid {...autoGridComposer.defaults} gap="md">
      <DemoCards />
    </AutoGrid>
  ),
};

export const GapSplit: Story = {
  name: "Gap split",
  render: () => (
    <AutoGrid {...autoGridComposer.defaults} gap="split">
      <DemoCards />
    </AutoGrid>
  ),
};

export const Fill: Story = {
  name: "Fill",
  render: () => (
    <AutoGrid {...autoGridComposer.defaults} fill>
      <DemoCards />
    </AutoGrid>
  ),
};
