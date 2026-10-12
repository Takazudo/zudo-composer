import type { Story } from "../preview/story-types";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("blog.footer");
export const PackDefaults: Story = { name: "Pack defaults", render: () => packDefaults("blog.footer") };
export const WithContent: Story = { name: "With content", render: () => showcase("blog.footer", false) };
export const Example: Story = { name: "In context", render: () => showcase("blog.footer", true) };
