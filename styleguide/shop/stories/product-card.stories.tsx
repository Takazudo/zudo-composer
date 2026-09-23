import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("shop.product-card");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("shop.product-card"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("shop.product-card", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("shop.product-card", true),
};
