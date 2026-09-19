import type { Story, StoryMeta } from "@takazudo/zudo-sg/stories";
import { Container, ProseP, SectionHeading } from "@zudo-composer/ui";
import {
  containerComposer,
  containerDisplay,
} from "@zudo-composer/ui/src/shared/container/container.composer.tsx";

const meta: StoryMeta = {
  ...containerDisplay,
  category: "Shared",
  usage: `import { Container } from "@zudo-composer/ui";

<Container>Page content goes here.</Container>`,
};
export default meta;

export const Defaults: Story = {
  name: "Defaults",
  render: () => (
    <Container {...containerComposer.defaults}>
      <SectionHeading
        eyebrow="Overview"
        heading="A centered content column"
        intro="Fluid inline padding keeps this content readable at every width."
      />
      <ProseP>Supporting copy sits inside the shared container boundary.</ProseP>
    </Container>
  ),
};
