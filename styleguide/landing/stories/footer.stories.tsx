import type { Story } from "../preview/story-types";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("land.footer");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("land.footer"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("land.footer", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("land.footer", true),
};
