import type { Story } from "../preview/story-types";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("land.stack");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("land.stack"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("land.stack", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("land.stack", true),
};
