import type { Story } from "../preview/story-types";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("blog.related-articles");
export const PackDefaults: Story = { name: "Pack defaults", render: () => packDefaults("blog.related-articles") };
export const WithContent: Story = { name: "With content", render: () => showcase("blog.related-articles", false) };
export const Example: Story = { name: "In context", render: () => showcase("blog.related-articles", true) };
