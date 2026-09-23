import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("shop.cart-page");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("shop.cart-page"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("shop.cart-page", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("shop.cart-page", true),
};
