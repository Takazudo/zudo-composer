import type { Plugin } from "vite";

export declare const HOST_STYLES_ID = "virtual:zudo-composer-host-styles";
export declare function hostStylesPlugin(options: { stylesPath: string; styles: string; configPath: string }): Plugin;
export default hostStylesPlugin;
