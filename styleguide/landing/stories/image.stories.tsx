import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("land.image");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("land.image"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("land.image", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("land.image", true),
};
