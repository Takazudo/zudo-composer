import type { Story } from "../preview/story-types";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("blog.comment");
export const PackDefaults: Story = { name: "Pack defaults", render: () => packDefaults("blog.comment") };
export const WithContent: Story = { name: "With content", render: () => showcase("blog.comment", false) };
export const Example: Story = { name: "In context", render: () => showcase("blog.comment", true) };
