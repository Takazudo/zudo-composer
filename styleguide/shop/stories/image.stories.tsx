import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("shop.image");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("shop.image"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("shop.image", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("shop.image", true),
};
