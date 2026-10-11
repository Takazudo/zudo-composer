import type { Story } from "../preview/story-types";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("land.testimonial");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("land.testimonial"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("land.testimonial", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("land.testimonial", true),
};
