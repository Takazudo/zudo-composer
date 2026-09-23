import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("land.cta-band");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("land.cta-band"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("land.cta-band", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("land.cta-band", true),
};
