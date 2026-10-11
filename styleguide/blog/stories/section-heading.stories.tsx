import type { Story } from "../preview/story-types";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("blog.section-heading");
export const PackDefaults: Story = { name: "Pack defaults", render: () => packDefaults("blog.section-heading") };
export const WithContent: Story = { name: "With content", render: () => showcase("blog.section-heading", false) };
export const Example: Story = { name: "In context", render: () => showcase("blog.section-heading", true) };
