import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("shop.faq-item");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("shop.faq-item"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("shop.faq-item", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("shop.faq-item", true),
};
