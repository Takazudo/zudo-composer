import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("shop.related-products");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("shop.related-products"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("shop.related-products", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("shop.related-products", true),
};
