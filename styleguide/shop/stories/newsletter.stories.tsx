import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("shop.newsletter");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("shop.newsletter"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("shop.newsletter", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("shop.newsletter", true),
};
