import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("land.pricing-table");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("land.pricing-table"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("land.pricing-table", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("land.pricing-table", true),
};
