import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("shop.price-tag");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("shop.price-tag"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("shop.price-tag", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("shop.price-tag", true),
};
