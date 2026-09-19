import type { Story, StoryMeta } from "@takazudo/zudo-sg/stories";
import { Card, ProseP, Stack } from "@zudo-composer/ui";
import {
  stackComposer,
  stackDisplay,
} from "@zudo-composer/ui/src/shared/stack/stack.composer.tsx";

const meta: StoryMeta = {
  ...stackDisplay,
  category: "Shared",
  usage: `import { Stack } from "@zudo-composer/ui";

<Stack>
  <div>First item</div>
  <div>Second item</div>
</Stack>`,
};
export default meta;

function DemoItems() {
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
    <Stack {...stackComposer.defaults}>
      <DemoItems />
    </Stack>
  ),
};

export const DirectionVertical: Story = {
  name: "Direction vertical",
  render: () => (
    <Stack {...stackComposer.defaults} direction="vertical">
      <DemoItems />
    </Stack>
  ),
};

export const DirectionHorizontal: Story = {
  name: "Direction horizontal",
  render: () => (
    <Stack {...stackComposer.defaults} direction="horizontal">
      <DemoItems />
    </Stack>
  ),
};

export const GapXs: Story = {
  name: "Gap xs",
  render: () => (
    <Stack {...stackComposer.defaults} gap="xs">
      <DemoItems />
    </Stack>
  ),
};

export const GapSm: Story = {
  name: "Gap sm",
  render: () => (
    <Stack {...stackComposer.defaults} gap="sm">
      <DemoItems />
    </Stack>
  ),
};

export const GapMd: Story = {
  name: "Gap md",
  render: () => (
    <Stack {...stackComposer.defaults} gap="md">
      <DemoItems />
    </Stack>
  ),
};

export const GapLg: Story = {
  name: "Gap lg",
  render: () => (
    <Stack {...stackComposer.defaults} gap="lg">
      <DemoItems />
    </Stack>
  ),
};

export const GapXl: Story = {
  name: "Gap xl",
  render: () => (
    <Stack {...stackComposer.defaults} gap="xl">
      <DemoItems />
    </Stack>
  ),
};

export const AlignStart: Story = {
  name: "Align start",
  render: () => (
    <Stack {...stackComposer.defaults} align="start">
      <DemoItems />
    </Stack>
  ),
};

export const AlignCenter: Story = {
  name: "Align center",
  render: () => (
    <Stack {...stackComposer.defaults} align="center">
      <DemoItems />
    </Stack>
  ),
};

export const AlignEnd: Story = {
  name: "Align end",
  render: () => (
    <Stack {...stackComposer.defaults} align="end">
      <DemoItems />
    </Stack>
  ),
};

export const AlignStretch: Story = {
  name: "Align stretch",
  render: () => (
    <Stack {...stackComposer.defaults} align="stretch">
      <DemoItems />
    </Stack>
  ),
};

export const JustifyStart: Story = {
  name: "Justify start",
  render: () => (
    <Stack {...stackComposer.defaults} justify="start">
      <DemoItems />
    </Stack>
  ),
};

export const JustifyCenter: Story = {
  name: "Justify center",
  render: () => (
    <Stack {...stackComposer.defaults} justify="center">
      <DemoItems />
    </Stack>
  ),
};

export const JustifyEnd: Story = {
  name: "Justify end",
  render: () => (
    <Stack {...stackComposer.defaults} justify="end">
      <DemoItems />
    </Stack>
  ),
};

export const JustifyBetween: Story = {
  name: "Justify between",
  render: () => (
    <Stack {...stackComposer.defaults} justify="between">
      <DemoItems />
    </Stack>
  ),
};
