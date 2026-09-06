import type { Plugin } from "vite";
import type { SiteProject } from "../src/site-project/model/types";
import type { CompletedRelease, ReleaseToolchain } from "../src/site-project/api/types";
import type { MediaType } from "../src/media/model";

export interface SiteProjectSourcePluginOptions {
  bundledSource: unknown;
  currentToolchain: ReleaseToolchain;
  readDevRelease?: () => Promise<{ project: SiteProject; release: CompletedRelease } | null>;
  readDevMedia?: (pathname: string) => Promise<{ bytes: Uint8Array; mediaType: MediaType; identity: CompletedRelease["identity"] } | null>;
}

export declare const SITE_PROJECT_SOURCE_ID = "virtual:site-project-source";
export declare const RESOLVED_SITE_PROJECT_SOURCE_ID: string;
export declare function assertBundledToolchain(source: unknown, currentToolchain: ReleaseToolchain): void;
export declare function siteProjectSourcePlugin(options: SiteProjectSourcePluginOptions): Plugin;
export default siteProjectSourcePlugin;
