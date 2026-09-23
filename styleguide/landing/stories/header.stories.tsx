import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("land.header");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("land.header"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("land.header", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("land.header", true),
};
