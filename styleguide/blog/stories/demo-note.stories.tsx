import type { Story } from "../preview/story-types";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("blog.demo-note");
export const PackDefaults: Story = { name: "Pack defaults", render: () => packDefaults("blog.demo-note") };
export const WithContent: Story = { name: "With content", render: () => showcase("blog.demo-note", false) };
export const Example: Story = { name: "In context", render: () => showcase("blog.demo-note", true) };
