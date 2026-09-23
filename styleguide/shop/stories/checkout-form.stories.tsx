import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("shop.checkout-form");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("shop.checkout-form"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("shop.checkout-form", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("shop.checkout-form", true),
};
