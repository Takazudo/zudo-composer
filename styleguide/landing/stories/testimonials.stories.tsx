import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("land.testimonials");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("land.testimonials"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("land.testimonials", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("land.testimonials", true),
};
