import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("blog.article-card");
export const PackDefaults: Story = { name: "Pack defaults", render: () => packDefaults("blog.article-card") };
export const WithContent: Story = { name: "With content", render: () => showcase("blog.article-card", false) };
export const Example: Story = { name: "In context", render: () => showcase("blog.article-card", true) };
