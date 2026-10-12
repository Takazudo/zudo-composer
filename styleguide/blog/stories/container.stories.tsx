import type { Story } from "../preview/story-types";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("blog.container");
export const PackDefaults: Story = { name: "Pack defaults", render: () => packDefaults("blog.container") };
export const WithContent: Story = { name: "With content", render: () => showcase("blog.container", false) };
export const Example: Story = { name: "In context", render: () => showcase("blog.container", true) };
