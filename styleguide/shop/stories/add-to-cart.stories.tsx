import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("shop.add-to-cart");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("shop.add-to-cart"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("shop.add-to-cart", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("shop.add-to-cart", true),
};
