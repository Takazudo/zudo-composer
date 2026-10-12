import type { Story } from "../preview/story-types";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("blog.callout");
export const PackDefaults: Story = { name: "Pack defaults", render: () => packDefaults("blog.callout") };
export const WithContent: Story = { name: "With content", render: () => showcase("blog.callout", false) };
export const Example: Story = { name: "In context", render: () => showcase("blog.callout", true) };
