import type { Story, StoryMeta } from "@takazudo/zudo-sg/stories";
import { Card, ProseP, type CardProps } from "@zudo-composer/ui";
import {
  cardComposer,
  cardDisplay,
} from "@zudo-composer/ui/src/cards/card/card.composer.tsx";

const meta: StoryMeta = {
  ...cardDisplay,
  category: "Cards",
  usage: `import { Card, ProseP } from "@zudo-composer/ui";

<Card title="Card heading">
  <ProseP>Use a card to group a small amount of related information.</ProseP>
</Card>`,
};
export default meta;

function CardBody() {
  return <ProseP>Use a card to group a small amount of related information.</ProseP>;
}

export const Defaults: Story = {
  name: "Defaults",
  render: () => (
    <Card {...cardComposer.defaults}>
      <CardBody />
    </Card>
  ),
};

export const Default: Story = {
  name: "Default",
  render: () => (
    <Card {...cardComposer.defaults} variant="default">
      <CardBody />
    </Card>
  ),
};

export const Accent: Story = {
  name: "Accent",
  render: () => (
    <Card {...cardComposer.defaults} variant="accent">
      <CardBody />
    </Card>
  ),
};

export const Muted: Story = {
  name: "Muted",
  render: () => (
    <Card {...cardComposer.defaults} variant="muted">
      <CardBody />
    </Card>
  ),
};

export const PaddingSm: Story = {
  name: "Padding: sm",
  render: () => (
    <Card {...cardComposer.defaults} padding="sm">
      <CardBody />
    </Card>
  ),
};

export const PaddingMd: Story = {
  name: "Padding: md",
  render: () => (
    <Card {...cardComposer.defaults} padding="md">
      <CardBody />
    </Card>
  ),
};

export const PaddingLg: Story = {
  name: "Padding: lg",
  render: () => (
    <Card {...cardComposer.defaults} padding="lg">
      <CardBody />
    </Card>
  ),
};

export const Interactive: Story<CardProps> = {
  name: "Interactive",
  render: (args) => (
    <Card {...cardComposer.defaults} {...args}>
      <CardBody />
    </Card>
  ),
  controls: [
    {
      type: "select",
      prop: "variant",
      label: "Variant",
      options: ["default", "accent", "muted"],
      defaultValue: "default",
    },
    {
      type: "select",
      prop: "padding",
      label: "Padding",
      options: ["sm", "md", "lg"],
      defaultValue: "md",
    },
    { type: "text", prop: "title", label: "Title", defaultValue: "Card heading" },
  ],
};
