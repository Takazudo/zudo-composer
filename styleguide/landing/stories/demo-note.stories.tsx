import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("land.demo-note");

export const PackDefaults: Story = {
  name: "Pack defaults",
  render: () => packDefaults("land.demo-note"),
};

export const WithContent: Story = {
  name: "With content",
  render: () => showcase("land.demo-note", false),
};

export const Example: Story = {
  name: "In context",
  render: () => showcase("land.demo-note", true),
};
