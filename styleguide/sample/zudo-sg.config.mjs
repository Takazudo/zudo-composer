/** @satisfies {import("@takazudo/zudo-sg/config").ZudoSgComposeOptions} */
export default {
  componentsRoots: [{ dir: "stories", importBase: "../../stories" }],
  registryOut: "./src/styleguide/sg-registry.ts",
  categoryOrder: ["Shared", "Cards", "Content", "Media"],
  // The generator imports StoryModule from here; the component pack does not export it.
  uiPackageName: "@takazudo/zudo-sg/stories",
  barrelIndex: null,
  previewStyles: "./src/styles/preview-entry.css",
  tokens: {
    cssFiles: [
      "./node_modules/@zudo-composer/ui/styles/tokens.css",
      "./node_modules/@zudo-composer/ui/styles/colors.css",
    ],
    manifestOut: "./src/styleguide/token-manifest.ts",
  },
};
