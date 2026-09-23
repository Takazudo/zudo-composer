import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("blog.home-hero");
export const PackDefaults: Story = { name: "Pack defaults", render: () => packDefaults("blog.home-hero") };
export const WithContent: Story = { name: "With content", render: () => showcase("blog.home-hero", false) };
export const Example: Story = { name: "In context", render: () => showcase("blog.home-hero", true) };
