import type { Story } from "../preview/story-types";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("blog.author-grid");
export const PackDefaults: Story = { name: "Pack defaults", render: () => packDefaults("blog.author-grid") };
export const WithContent: Story = { name: "With content", render: () => showcase("blog.author-grid", false) };
export const Example: Story = { name: "In context", render: () => showcase("blog.author-grid", true) };
