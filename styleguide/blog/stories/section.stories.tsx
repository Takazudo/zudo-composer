import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("blog.section");
export const PackDefaults: Story = { name: "Pack defaults", render: () => packDefaults("blog.section") };
export const WithContent: Story = { name: "With content", render: () => showcase("blog.section", false) };
export const Example: Story = { name: "In context", render: () => showcase("blog.section", true) };
