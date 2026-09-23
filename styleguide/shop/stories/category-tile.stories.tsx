import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("shop.category-tile");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("shop.category-tile"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("shop.category-tile", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("shop.category-tile", true),
};
