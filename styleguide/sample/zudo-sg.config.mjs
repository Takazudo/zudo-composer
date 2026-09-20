/** @satisfies {import("@takazudo/zudo-sg/config").ZudoSgComposeOptions} */
export default {
  componentsRoots: [{ dir: "stories", importBase: "../../stories" }],
  registryOut: "./src/styleguide/sg-registry.ts",
  categoryOrder: ["Shared", "Cards", "Content", "Media"],
  uiPackageName: "@zudo-composer/ui",
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
