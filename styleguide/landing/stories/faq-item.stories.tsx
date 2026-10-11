import type { Story } from "../preview/story-types";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("land.faq-item");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("land.faq-item"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("land.faq-item", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("land.faq-item", true),
};
