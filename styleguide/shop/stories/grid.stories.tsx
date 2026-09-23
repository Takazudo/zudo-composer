import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("shop.grid");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("shop.grid"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("shop.grid", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("shop.grid", true),
};
