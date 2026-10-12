import type { Story } from "../preview/story-types";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("land.stats");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("land.stats"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("land.stats", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("land.stats", true),
};
