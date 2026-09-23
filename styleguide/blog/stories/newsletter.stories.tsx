import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("blog.newsletter");
export const PackDefaults: Story = { name: "Pack defaults", render: () => packDefaults("blog.newsletter") };
export const WithContent: Story = { name: "With content", render: () => showcase("blog.newsletter", false) };
export const Example: Story = { name: "In context", render: () => showcase("blog.newsletter", true) };
