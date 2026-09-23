import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("land.steps-row");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("land.steps-row"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("land.steps-row", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("land.steps-row", true),
};
