/** @satisfies {import("@takazudo/zudo-sg/config").ZudoSgComposeOptions} */
export default {
  componentsRoots: [{ dir: "stories", importBase: "../../stories" }],
  registryOut: "./src/styleguide/sg-registry.ts",
  categoryOrder: ["Chrome", "Layout", "Content", "Articles", "Comments"],
  uiPackageName: "demo-blog",
  barrelIndex: null,
  previewStyles: "./src/styles/preview-entry.css",
  catalog: { title: "Blog components", intro: "The real Margin Notes component pack, with articles, author pages, comments, and newsletter interactions." },
  tokens: { manifestOut: "./src/styleguide/token-manifest.ts" },
};
