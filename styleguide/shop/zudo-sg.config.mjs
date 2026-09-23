/** @satisfies {import("@takazudo/zudo-sg/config").ZudoSgComposeOptions} */
export default {
  componentsRoots: [{ dir: "stories", importBase: "../../stories" }],
  registryOut: "./src/styleguide/sg-registry.ts",
  categoryOrder: ["Chrome", "Layout", "Catalog", "Content", "Product", "Cart"],
  uiPackageName: "demo-webshop",
  barrelIndex: null,
  previewStyles: "./src/styles/preview-entry.css",
  catalog: { title: "Shop components", intro: "The real Nightjar Supply component pack, with working storefront interactions." },
  tokens: { manifestOut: "./src/styleguide/token-manifest.ts" },
};
