import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("land.prose");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("land.prose"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("land.prose", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("land.prose", true),
};
