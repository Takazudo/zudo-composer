/** @satisfies {import("@takazudo/zudo-sg/config").ZudoSgComposeOptions} */
export default {
  componentsRoots: [{ dir: "stories", importBase: "../../stories" }],
  registryOut: "./src/styleguide/sg-registry.ts",
  categoryOrder: ["Chrome", "Layout", "Content", "Marketing", "Forms"],
  uiPackageName: "demo-landing",
  barrelIndex: null,
  previewStyles: "./src/styles/preview-entry.css",
  catalog: { title: "Landing components", intro: "The real Orrery component pack, with live pricing, FAQ and form interactions." },
  tokens: { manifestOut: "./src/styleguide/token-manifest.ts" },
};
