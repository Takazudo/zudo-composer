import type { Story } from "../preview/story-types";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("land.comparison-note");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("land.comparison-note"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("land.comparison-note", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("land.comparison-note", true),
};
