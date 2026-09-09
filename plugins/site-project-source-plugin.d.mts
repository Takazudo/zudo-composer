import type { Plugin } from "vite";
import type { SiteProject } from "../src/site-project/model/types";
import type { CompletedRelease } from "../src/site-project/api/types";
import type { AssetType } from "../src/assets/model";

export interface SiteProjectSourcePluginOptions {
  readDevRelease?: () => Promise<{ project: SiteProject; release: CompletedRelease } | null>;
  readDevAsset?: (pathname: string) => Promise<{ bytes: Uint8Array; mimeType: AssetType; identity: CompletedRelease["identity"] } | null>;
  workspaceRoot?: string;
  packIdentity?: import("./component-pack.d.mts").ResolvedComponentPack;
}

export declare const SITE_PROJECT_SOURCE_ID = "virtual:site-project-source";
export declare const RESOLVED_SITE_PROJECT_SOURCE_ID: string;
export declare function siteProjectSourcePlugin(options?: SiteProjectSourcePluginOptions): Plugin;
export default siteProjectSourcePlugin;
