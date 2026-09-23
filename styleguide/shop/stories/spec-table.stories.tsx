import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("shop.spec-table");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("shop.spec-table"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("shop.spec-table", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("shop.spec-table", true),
};
