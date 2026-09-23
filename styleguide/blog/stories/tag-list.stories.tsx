import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("blog.tag-list");
export const PackDefaults: Story = { name: "Pack defaults", render: () => packDefaults("blog.tag-list") };
export const WithContent: Story = { name: "With content", render: () => showcase("blog.tag-list", false) };
export const Example: Story = { name: "In context", render: () => showcase("blog.tag-list", true) };
