import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("shop.footer");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("shop.footer"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("shop.footer", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("shop.footer", true),
};
