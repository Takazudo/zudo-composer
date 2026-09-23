import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("blog.comment-form");
export const PackDefaults: Story = { name: "Pack defaults", render: () => packDefaults("blog.comment-form") };
export const WithContent: Story = { name: "With content", render: () => showcase("blog.comment-form", false) };
export const Example: Story = { name: "In context", render: () => showcase("blog.comment-form", true) };
