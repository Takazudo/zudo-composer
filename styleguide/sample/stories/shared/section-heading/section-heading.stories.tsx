import type { Story, StoryMeta } from "@takazudo/zudo-sg/stories";
import { SectionHeading } from "@zudo-composer/ui";
import {
  sectionHeadingComposer,
  sectionHeadingDisplay,
} from "@zudo-composer/ui/src/shared/section-heading/section-heading.composer.tsx";

const meta: StoryMeta = {
  ...sectionHeadingDisplay,
  category: "Shared",
  usage: `import { SectionHeading } from "@zudo-composer/ui";

<SectionHeading
  eyebrow="About"
  heading="Our approach"
  intro="A short supporting sentence."
/>`,
};
export default meta;

export const Defaults: Story = {
  name: "Defaults",
  render: () => <SectionHeading {...sectionHeadingComposer.defaults} />,
};

export const H1: Story = {
  name: "H1",
  render: () => <SectionHeading {...sectionHeadingComposer.defaults} as="h1" />,
};

export const H2: Story = {
  name: "H2",
  render: () => <SectionHeading {...sectionHeadingComposer.defaults} as="h2" />,
};
