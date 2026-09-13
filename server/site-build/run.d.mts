import type { InlineConfig } from "vite";
import type { SiteManifest } from "../site-build.mjs";

export interface BuildSiteOptions {
  /** Absolute resolved host path; defaults to the current working directory. */
  workspaceRoot?: string;
  /** Inspect an existing artifact and print its manifest routes as JSON. */
  printRoutes?: boolean;
  /** Absolute resolved artifact directory to verify without building. */
  verifyDirectory?: string;
  /** Host revision to record or verify exactly; defaults to GITHUB_SHA, absent otherwise. */
  sourceRevision?: string;
  /** Environment for host config and the GITHUB_SHA default; defaults to process.env. */
  env?: Record<string, string | undefined>;
}

export function runSiteBuild(
  options?: BuildSiteOptions,
  deps?: { build?: (config: InlineConfig) => Promise<unknown> },
): Promise<SiteManifest>;
