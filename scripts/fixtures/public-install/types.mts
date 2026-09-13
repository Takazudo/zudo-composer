import * as rootPublic from "zudo-composer";
import type { ComposerDevServerOptions } from "zudo-composer";
import * as configPublic from "zudo-composer/config";
import type {
  ComposerConfig,
  ComposerConfigInput,
  ComposerConfigOverrides,
  ComposerPaths,
  ComposerRuntime,
  ComposerSettingDefaults,
  ComposerSettings,
  ResolvedComposerConfig,
} from "zudo-composer/config";
import * as authoring from "zudo-composer/authoring";
import { compileStaticSite, createSiteManifest, type StaticSiteCompilation, type SiteManifest, type ToolIdentity } from "zudo-composer/site-build";
import type { SiteProject } from "zudo-composer/site-project";
import * as vitePublic from "zudo-composer/vite";
import { loadHostContext, type HostContext, type ResolvedComponentPack } from "zudo-composer/vite";
import type { TrustedComponentPack } from "@zudo-composer/component-contract";
import type { InlineConfig, Plugin, ViteDevServer } from "vite";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
export type AuthoringExports = Assert<Equal<keyof typeof authoring, "COMPOSITION_PROVIDER_ID" | "CONTENT_PROVIDER_ID" | "DEFAULT_TIMESTAMP" | "MAPPING_PROVIDER_ID" | "SITEMAP_PROVIDER_ID" | "assetAuthoringUrl" | "assetMimeTypeForExtension" | "createFilesystemAssetStore" | "canonicalStringifyJson" | "defineSite" | "entryRef" | "node" | "readAssetUrls" | "slugify" | "validateSiteProject">>;
export type RootExports = Assert<Equal<keyof typeof rootPublic, "OPTIMIZE_DEPS_EXCLUDE" | "loadHostConfig" | "resolveComposerDevConfig" | "startComposerDevServer">>;
export type ConfigExports = Assert<Equal<keyof typeof configPublic, "defineComposerConfig">>;
export type ViteExports = Assert<Equal<keyof typeof vitePublic,
  "APP_ENTRY_MODULE" | "APP_ROOT" | "COMPONENT_PACK_ID" | "HOST_STYLES_ID" |
  "appModuleId" | "assertPackSourcesResolvable" | "componentPackPlugin" |
  "composerAppHtmlPlugin" | "composerFileProviderPlugin" | "fsModuleId" |
  "hostStylesPlugin" | "loadHostContext" | "resolveComponentPack" |
  "resolveWorkspaceRoot" | "siteProjectSourcePlugin"
>>;

export type ConfigParameter = Assert<Equal<Parameters<typeof configPublic.defineComposerConfig>[0], ComposerConfig>>;
export type ConfigReturn = Assert<Equal<ReturnType<typeof configPublic.defineComposerConfig>, ComposerConfig>>;
export type ResolveOptions = Assert<Equal<Parameters<typeof rootPublic.resolveComposerDevConfig>[0], ComposerDevServerOptions | undefined>>;
export type StartOptions = Assert<Equal<Parameters<typeof rootPublic.startComposerDevServer>[0], ComposerDevServerOptions | undefined>>;
export type RootConfig = Assert<Equal<Awaited<ReturnType<typeof rootPublic.loadHostConfig>>, ResolvedComposerConfig>>;
export type ResolveConfig = Assert<Equal<Awaited<ReturnType<typeof rootPublic.resolveComposerDevConfig>>["composerConfig"], ResolvedComposerConfig>>;
export type StartConfig = Assert<Equal<Awaited<ReturnType<typeof rootPublic.startComposerDevServer>>["composerConfig"], ResolvedComposerConfig>>;
export type ContextConfig = Assert<Equal<HostContext["composerConfig"], ResolvedComposerConfig>>;
export type ViteInlineIdentity = Assert<Equal<Awaited<ReturnType<typeof rootPublic.resolveComposerDevConfig>>["inlineConfig"], InlineConfig>>;
export type ViteServerIdentity = Assert<Equal<Awaited<ReturnType<typeof rootPublic.startComposerDevServer>>["server"], ViteDevServer>>;
export type ConfigPaths = Assert<Equal<ResolvedComposerConfig["paths"], ComposerPaths>>;
export type ConfigSettings = Assert<Equal<ResolvedComposerConfig["settings"], ComposerSettings>>;
export type ConfigDefaults = Assert<Equal<ComposerSettingDefaults, Omit<ComposerSettings, "pack">>>;
export type ConfigInput = Assert<Equal<ComposerConfigInput, Partial<ComposerSettings> & ComposerConfigOverrides>>;
export type RuntimeEnvironment = Assert<Equal<ComposerRuntime["env"], Record<string, string | undefined> | undefined>>;
export type OptimizeDepsExclude = Assert<Equal<typeof rootPublic.OPTIMIZE_DEPS_EXCLUDE, readonly string[]>>;

type SourcePluginOptions = NonNullable<Parameters<typeof vitePublic.siteProjectSourcePlugin>[0]>;
type DevRelease = NonNullable<Awaited<ReturnType<NonNullable<SourcePluginOptions["readDevRelease"]>>>>;
export type ExternalPackIdentity = Assert<Equal<HostContext["pack"], TrustedComponentPack>>;
export type ExternalPluginIdentity = Assert<Equal<ReturnType<typeof vitePublic.siteProjectSourcePlugin>, Plugin>>;
export type ProjectIdentity = Assert<Equal<DevRelease["project"], SiteProject>>;
export type CompilationReturn = Assert<Equal<Awaited<ReturnType<typeof compileStaticSite>>, StaticSiteCompilation>>;
export type ContextReturn = Assert<Equal<Awaited<ReturnType<typeof loadHostContext>>, HostContext>>;
export type PackIdentity = Assert<Equal<HostContext["packIdentity"], ResolvedComponentPack>>;
export type ValidationIsTyped = Assert<Equal<ReturnType<typeof authoring.validateSiteProject>["ok"], boolean>>;
export type ManifestToolIdentity = Assert<Equal<SiteManifest["tool"], ToolIdentity>>;
export type OptionalHostRevision = Assert<Equal<SiteManifest["sourceRevision"], string | undefined>>;
export type OptionalToolGitHead = Assert<Equal<ToolIdentity["gitHead"], string | undefined>>;
export type ManifestOptions = Assert<Equal<Parameters<typeof createSiteManifest>[0]["sourceRevision"], string | undefined>>;

export const config: ComposerConfig = configPublic.defineComposerConfig({ pack: "public-entry-host/components", workspaceRoot: "/tmp/host" });
export const input: ComposerConfigInput = {};
export const overrides: ComposerConfigOverrides = { workspaceRoot: "/tmp/host" };
export const runtime: ComposerRuntime = { env: { HOST_SETTING: "typed" } };

export async function readHostAssets(root: string): Promise<Record<string, string>> {
  const fromRoot: ResolvedComposerConfig = await rootPublic.loadHostConfig(root);
  const context = await loadHostContext({ workspaceRoot: root });
  const fromVite: ResolvedComposerConfig = context.composerConfig;
  const options: ComposerDevServerOptions = { workspaceRoot: root, port: 4321, host: true, strictPort: true };
  const resolved = await rootPublic.resolveComposerDevConfig(options);
  const fromServer: ResolvedComposerConfig = resolved.composerConfig;
  return { ...authoring.readAssetUrls(fromRoot), ...authoring.readAssetUrls(fromVite), ...authoring.readAssetUrls(fromServer) };
}

export async function consumer(root: string): Promise<SiteManifest["routes"]> {
  const context = await loadHostContext({ workspaceRoot: root });
  const store = await authoring.createFilesystemAssetStore({ assetsStoreRoot: root });
  const snapshot = await store.snapshot();
  const token: string = snapshot.mutationToken;
  authoring.canonicalStringifyJson({ token });
  const compiled = await compileStaticSite({ projectPath: "site-project.json", pack: context.pack, assetsStoreRoot: root });
  const validation = authoring.validateSiteProject(compiled.project, { componentPack: context.pack.manifest });
  if (validation.ok) authoring.assetAuthoringUrl(validation.project.id);
  return compiled.build.routes.map(({ pathname }) => pathname);
}

// @ts-expect-error The filesystem store needs an explicit path, never an untyped option bag.
authoring.createFilesystemAssetStore({});
// @ts-expect-error Canonical JSON cannot contain undefined.
authoring.canonicalStringifyJson({ invalid: undefined });
// @ts-expect-error Site-build configuration must name a trusted component pack.
compileStaticSite({ projectPath: "site-project.json", assetsStoreRoot: "cms/assets" });
// @ts-expect-error The host configuration requires its pack.
configPublic.defineComposerConfig({});
// @ts-expect-error The host configuration accepts string path settings.
configPublic.defineComposerConfig({ pack: "public-entry-host/components", assetsDir: 123 });
// @ts-expect-error Dev server options require a numeric port.
rootPublic.resolveComposerDevConfig({ port: "4321" });
// @ts-expect-error The supported Vite entry does not expose private middleware.
import { createAssetUploadMiddleware } from "zudo-composer/vite";
// @ts-expect-error This internal resolver is not a public config value.
import { composer } from "zudo-composer/config";
// @ts-expect-error The config loader seam is not a named public config type.
import type { ComposerConfigLoader } from "zudo-composer/config";
// @ts-expect-error Root public API does not export resolved config types.
import type { ResolvedComposerConfig as RootResolved } from "zudo-composer";
export type RejectedInternals = [typeof createAssetUploadMiddleware, typeof composer, ComposerConfigLoader, RootResolved];

declare const copiedRoot: typeof rootPublic;
// @ts-expect-error Preserve the original root module constant property's readonly behavior.
copiedRoot.OPTIMIZE_DEPS_EXCLUDE = [];
// @ts-expect-error The excluded dependencies array is also readonly.
copiedRoot.OPTIMIZE_DEPS_EXCLUDE.push("host-dependency");
