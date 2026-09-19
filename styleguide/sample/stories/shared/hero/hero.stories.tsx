import type { Story, StoryMeta } from "@takazudo/zudo-sg/stories";
import { Hero } from "@zudo-composer/ui";
import {
  heroComposer,
  heroDisplay,
} from "@zudo-composer/ui/src/shared/hero/hero.composer.tsx";

const meta: StoryMeta = {
  ...heroDisplay,
  category: "Shared",
  usage: `import { Hero } from "@zudo-composer/ui";

<Hero
  eyebrow="Welcome"
  heading="Build things that last"
  lead="A sample lead paragraph."
  actions={[{ label: "Get started", href: "#" }]}
/>`,
};
export default meta;

export const Defaults: Story = {
  name: "Defaults",
  render: () => (
    <Hero
      {...heroComposer.defaults}
      actions={heroComposer.defaults.actions.map((action) => ({ ...action }))}
    />
  ),
};

export const Primary: Story = {
  name: "Primary",
  render: () => (
    <Hero
      {...heroComposer.defaults}
      variant="primary"
      actions={heroComposer.defaults.actions.map((action) => ({ ...action }))}
    />
  ),
};

export const Secondary: Story = {
  name: "Secondary",
  render: () => (
    <Hero
      {...heroComposer.defaults}
      variant="secondary"
      actions={heroComposer.defaults.actions.map((action) => ({ ...action }))}
    />
  ),
};
