import type { Story, StoryMeta } from "@takazudo/zudo-sg/stories";
import { PlaceholderBox } from "@zudo-composer/ui";
import {
  placeholderBoxComposer,
  placeholderBoxDisplay,
} from "@zudo-composer/ui/src/media/placeholder-box/placeholder-box.composer.tsx";

const meta: StoryMeta = {
  ...placeholderBoxDisplay,
  category: "Media",
  usage: `import { PlaceholderBox } from "@zudo-composer/ui";

<PlaceholderBox label="hero-image.png" aspect="16/9" />`,
};
export default meta;

export const Defaults: Story = {
  name: "Defaults",
  render: () => <PlaceholderBox {...placeholderBoxComposer.defaults} />,
};

export const Aspect169: Story = {
  name: "Aspect: 16/9",
  render: () => <PlaceholderBox {...placeholderBoxComposer.defaults} aspect="16/9" />,
};

export const Aspect43: Story = {
  name: "Aspect: 4/3",
  render: () => <PlaceholderBox {...placeholderBoxComposer.defaults} aspect="4/3" />,
};

export const Aspect11: Story = {
  name: "Aspect: 1/1",
  render: () => <PlaceholderBox {...placeholderBoxComposer.defaults} aspect="1/1" />,
};

export const SizeSm: Story = {
  name: "Size: sm",
  render: () => <PlaceholderBox {...placeholderBoxComposer.defaults} size="sm" />,
};

export const SizeMd: Story = {
  name: "Size: md",
  render: () => <PlaceholderBox {...placeholderBoxComposer.defaults} size="md" />,
};

export const SizeLg: Story = {
  name: "Size: lg",
  render: () => <PlaceholderBox {...placeholderBoxComposer.defaults} size="lg" />,
};

type PlaceholderBoxStoryProps = {
  label?: string;
  aspect?: "16/9" | "4/3" | "1/1";
  size?: "sm" | "md" | "lg";
};

export const Interactive: Story<PlaceholderBoxStoryProps> = {
  name: "Interactive",
  render: (args) => <PlaceholderBox {...placeholderBoxComposer.defaults} {...args} />,
  controls: [
    { type: "text", prop: "label", label: "Label", defaultValue: "hero-image.png" },
    {
      type: "select",
      prop: "aspect",
      label: "Aspect ratio",
      options: ["16/9", "4/3", "1/1"],
      defaultValue: "16/9",
    },
    {
      type: "select",
      prop: "size",
      label: "Size",
      options: ["sm", "md", "lg"],
      defaultValue: "md",
    },
  ],
};
