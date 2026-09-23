import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("land.signup-form");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("land.signup-form"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("land.signup-form", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("land.signup-form", true),
};
