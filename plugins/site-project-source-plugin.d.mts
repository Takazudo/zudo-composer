import type { Plugin } from "vite";
import type { SiteProject } from "../src/site-project/model/types";

export interface SiteProjectSourcePluginOptions {
  bundledProject: SiteProject;
  bundledRevision: string;
  readDevProject?: () => Promise<{ project: SiteProject; revision: string } | null>;
}

export declare const SITE_PROJECT_SOURCE_ID = "virtual:site-project-source";
export declare const RESOLVED_SITE_PROJECT_SOURCE_ID: string;
export declare function siteProjectSourcePlugin(options: SiteProjectSourcePluginOptions): Plugin;
export default siteProjectSourcePlugin;
