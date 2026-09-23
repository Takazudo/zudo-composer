import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("shop.header");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("shop.header"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("shop.header", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("shop.header", true),
};
