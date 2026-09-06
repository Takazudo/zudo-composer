// @ts-check
// `virtual:zudo-composer-host-styles` — the host's own base stylesheet.
//
// Styles ownership: tool CSS never imports pack CSS. The host's configured
// `styles` file is the SOLE importer of the component pack's stylesheet and the
// host's Tailwind `@source` declaration point, so a themeset's class names are
// scanned because the host said where they live, not because the tool guessed.
//
// `resolveId` returns the file's real absolute path rather than a `\0` virtual
// id: Vite and Tailwind then treat it as an ordinary CSS file, so its relative
// `@import` and `@source` bases are the host's directory — which is the whole
// point of letting the host own it.

import { existsSync } from "node:fs";

export const HOST_STYLES_ID = "virtual:zudo-composer-host-styles";

/**
 * @param {{stylesPath: string, styles: string, configPath: string}} options
 */
export function hostStylesPlugin(options) {
  return {
    name: "zudo-composer-host-styles",
    enforce: /** @type {const} */ ("pre"),
    buildStart() {
      if (existsSync(options.stylesPath)) return;
      throw new Error(
        `zudo-composer config: \`styles\` points at "${options.styles}", which does not exist at ${options.stylesPath}. It is the host's base stylesheet — the only importer of the component pack's CSS and the host's Tailwind \`@source\` point. Create it, or set \`styles\` in ${options.configPath}.`,
      );
    },
    resolveId(id) {
      if (id === HOST_STYLES_ID) return options.stylesPath;
    },
  };
}

export default hostStylesPlugin;
