import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("blog.prose-body");
export const PackDefaults: Story = { name: "Pack defaults", render: () => packDefaults("blog.prose-body") };
export const WithContent: Story = { name: "With content", render: () => showcase("blog.prose-body", false) };
export const Example: Story = { name: "In context", render: () => showcase("blog.prose-body", true) };
