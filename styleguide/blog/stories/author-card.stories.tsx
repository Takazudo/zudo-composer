import type { Story } from "../preview/story-types";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("blog.author-card");
export const PackDefaults: Story = { name: "Pack defaults", render: () => packDefaults("blog.author-card") };
export const WithContent: Story = { name: "With content", render: () => showcase("blog.author-card", false) };
export const Example: Story = { name: "In context", render: () => showcase("blog.author-card", true) };
