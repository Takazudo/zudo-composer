import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("land.feature-item");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("land.feature-item"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("land.feature-item", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("land.feature-item", true),
};
