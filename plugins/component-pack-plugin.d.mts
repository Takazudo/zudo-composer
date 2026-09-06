import type { Plugin } from "vite";
import type { ResolvedComponentPack } from "./component-pack.d.mts";

export declare const COMPONENT_PACK_ID = "virtual:zudo-composer-pack";
export declare const RESOLVED_COMPONENT_PACK_ID: string;
export declare function componentPackPlugin(options: { workspaceRoot: string; pack: string }): Plugin & {
  identity: ResolvedComponentPack;
};
export default componentPackPlugin;
