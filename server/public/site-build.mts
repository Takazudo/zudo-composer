// Stable Node façade. Host-rooted configuration and CLI commands build on these
// operations; callers never need the repository's scripts or visitor entry.
export { compileStaticSite, type StaticSiteCompilation } from "../site-build/compile.js";
export {
  SITE_HEADERS,
  SITE_MANIFEST,
  createSiteManifest,
  siteHeaders,
  verifySiteStaticArtifact,
  type SiteManifest,
  type ToolIdentity,
} from "../site-build/artifact.mjs";
