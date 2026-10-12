import { externalPreview } from "./src/config/preview.mjs";

/** @satisfies {import("@takazudo/zudo-sg/config").ZudoSgComposeOptions} */
const config = {
  registry: { mode: "descriptor", module: "./src/styleguide/descriptors.ts" },
  externalPreview,
  componentsRoots: [{ dir: "stories", importBase: "../../stories" }],
  registryOut: "./src/styleguide/sg-registry.ts",
  categoryOrder: ["Shared", "Cards", "Content", "Media"],
  uiPackageName: "@zudo-composer/ui",
  barrelIndex: null,
  previewStyles: "./src/styles/shell-preview.css",
  tokens: {
    cssFiles: [
      "./node_modules/@zudo-composer/ui/styles/tokens.css",
      "./node_modules/@zudo-composer/ui/styles/colors.css",
    ],
    manifestOut: "./src/styleguide/token-manifest.ts",
  },
  // Tabs-only shape (routingFile/writeRoot omitted): the header trigger's
  // preview token panel gets the manifest-derived tabs, but no dev-only Apply
  // write sandbox. Live preview still works through applySink.
  zdtpApplyProxy: {
    tabsModule: "./src/config/preview-token-panel-tabs.ts",
  },
};

export default config;
