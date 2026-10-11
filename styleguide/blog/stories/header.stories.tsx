import type { Story } from "../preview/story-types";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("blog.header");
export const PackDefaults: Story = { name: "Pack defaults", render: () => packDefaults("blog.header") };
export const WithContent: Story = { name: "With content", render: () => showcase("blog.header", false) };
export const Example: Story = { name: "In context", render: () => showcase("blog.header", true) };
