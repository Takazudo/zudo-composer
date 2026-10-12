import type { Story } from "../preview/story-types";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("blog.stack");
export const PackDefaults: Story = { name: "Pack defaults", render: () => packDefaults("blog.stack") };
export const WithContent: Story = { name: "With content", render: () => showcase("blog.stack", false) };
export const Example: Story = { name: "In context", render: () => showcase("blog.stack", true) };
