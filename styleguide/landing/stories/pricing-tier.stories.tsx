import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("land.pricing-tier");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("land.pricing-tier"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("land.pricing-tier", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("land.pricing-tier", true),
};
