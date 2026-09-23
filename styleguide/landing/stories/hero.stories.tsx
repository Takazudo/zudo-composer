import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("land.hero");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("land.hero"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("land.hero", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("land.hero", true),
};
