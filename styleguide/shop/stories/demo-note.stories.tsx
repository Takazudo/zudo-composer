import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("shop.demo-note");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("shop.demo-note"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("shop.demo-note", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("shop.demo-note", true),
};
