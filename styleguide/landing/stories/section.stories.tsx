import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("land.section");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("land.section"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("land.section", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("land.section", true),
};
