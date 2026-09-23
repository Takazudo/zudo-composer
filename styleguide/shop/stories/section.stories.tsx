import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("shop.section");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("shop.section"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("shop.section", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("shop.section", true),
};
