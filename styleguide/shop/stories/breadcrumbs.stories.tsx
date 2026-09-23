import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("shop.breadcrumbs");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("shop.breadcrumbs"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("shop.breadcrumbs", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("shop.breadcrumbs", true),
};
