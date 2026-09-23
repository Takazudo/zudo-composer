import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, storyMeta, showcase } from "./showcases";

export default storyMeta("blog.nav-link");
export const PackDefaults: Story = { name: "Pack defaults", render: () => packDefaults("blog.nav-link") };
export const WithContent: Story = { name: "With content", render: () => showcase("blog.nav-link", false) };
export const Example: Story = { name: "In context", render: () => showcase("blog.nav-link", true) };
