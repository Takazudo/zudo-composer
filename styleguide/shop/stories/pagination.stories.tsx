import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("shop.pagination");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("shop.pagination"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("shop.pagination", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("shop.pagination", true),
};
