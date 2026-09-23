import type { Story } from "@takazudo/zudo-sg/stories";
import { packDefaults, routeArticleList, storyMeta, showcase } from "./showcases";

export default storyMeta("blog.article-list");
export const PackDefaults: Story = { name: "Pack defaults", render: () => packDefaults("blog.article-list") };
export const WithContent: Story = { name: "With content", render: () => showcase("blog.article-list", false) };
export const Example: Story = { name: "In context", render: () => showcase("blog.article-list", true) };
export const ExcludeCurrentArticle: Story = { name: "Exclude current article", render: () => routeArticleList("exclude-route") };
