import type { Story, StoryMeta } from "@takazudo/zudo-sg/stories";
import { CtaButton } from "@zudo-composer/ui";
import {
  ctaButtonComposer,
  ctaButtonDisplay,
} from "@zudo-composer/ui/src/shared/cta-button/cta-button.composer.tsx";

const meta: StoryMeta = {
  ...ctaButtonDisplay,
  category: "Shared",
  usage: `import { CtaButton } from "@zudo-composer/ui";

<CtaButton href="/products">Browse products</CtaButton>`,
};
export default meta;

export const Defaults: Story = {
  name: "Defaults",
  render: () => <CtaButton {...ctaButtonComposer.defaults} />,
};

export const Primary: Story = {
  name: "Primary",
  render: () => <CtaButton {...ctaButtonComposer.defaults} variant="primary" />,
};

export const Secondary: Story = {
  name: "Secondary",
  render: () => <CtaButton {...ctaButtonComposer.defaults} variant="secondary" />,
};

export const NoArrow: Story = {
  name: "No arrow",
  render: () => <CtaButton {...ctaButtonComposer.defaults} arrow={false} />,
};
