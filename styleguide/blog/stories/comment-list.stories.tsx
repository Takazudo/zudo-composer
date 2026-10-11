import type { Story } from "../preview/story-types";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("blog.comment-list");
export const PackDefaults: Story = { name: "Pack defaults", render: () => packDefaults("blog.comment-list") };
export const WithContent: Story = { name: "With content", render: () => showcase("blog.comment-list", false) };
export const Example: Story = { name: "In context", render: () => showcase("blog.comment-list", true) };
