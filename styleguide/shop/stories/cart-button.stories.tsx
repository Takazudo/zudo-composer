import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("shop.cart-button");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("shop.cart-button"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("shop.cart-button", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("shop.cart-button", true),
};
