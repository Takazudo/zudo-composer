import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("land.logo-strip");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("land.logo-strip"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("land.logo-strip", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("land.logo-strip", true),
};
