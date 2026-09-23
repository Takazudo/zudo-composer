import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("shop.faq-accordion");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("shop.faq-accordion"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("shop.faq-accordion", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("shop.faq-accordion", true),
};
