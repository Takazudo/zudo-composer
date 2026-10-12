import { readFile } from "node:fs/promises";
import { join } from "node:path";
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
import * as content from "zudo-composer/content";
import type { ContentMutationAuthorization, ContentMutationRequest, HostContentPolicy, SiteProjectPlan, SiteProjectPlanCompilation } from "zudo-composer/content";
import * as editing from "zudo-composer/editing";
import * as exportPublic from "zudo-composer/export";
import type { ContentExportAdapter, ContentExportStatus, ContentExportSubmission } from "zudo-composer/export";
import * as hostStorage from "zudo-composer/host-storage";
import type { ContentBaseline, ContentDraftApplied, ContentDraftMutationResult, ContentDraftStorageAdapter, ContentEditorStorage, ContentSnapshotRecord, HostContentApplyResult } from "zudo-composer/host-storage";
import type * as contentEditor from "zudo-composer/content-editor";
import * as previewProtocol from "zudo-composer/preview-protocol";
import type { HostPreviewBridge, HostPreviewRequest, PreviewToHostMessage } from "zudo-composer/preview-protocol";
import type { EditRequest, EditPlan, EditReceipt } from "zudo-composer/editing";
import { compileStaticSite, createSiteManifest, type StaticSiteCompilation, type SiteManifest, type ToolIdentity } from "zudo-composer/site-build";
import type { SiteProject } from "zudo-composer/site-project";
import * as vitePublic from "zudo-composer/vite";
import { loadHostContext, type HostContext, type ResolvedComponentPack } from "zudo-composer/vite";
import type { TrustedComponentPack } from "@zudo-composer/component-contract";
import type { InlineConfig, Plugin, ViteDevServer } from "vite";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
export type AuthoringExports = Assert<Equal<keyof typeof authoring, "ASSET_PROVIDER_ID" | "COMPOSITION_PROVIDER_ID" | "CONTENT_PROVIDER_ID" | "DEFAULT_TIMESTAMP" | "MAPPING_PROVIDER_ID" | "SITEMAP_PROVIDER_ID" | "assetAuthoringUrl" | "assetMimeTypeForExtension" | "createFilesystemAssetStore" | "canonicalStringifyJson" | "defineSite" | "entryRef" | "imageUse" | "initializeAuthoringWorkspace" | "node" | "slugify" | "validateSiteProject">>;
export type EditingExports = Assert<Equal<keyof typeof editing, "createEditingService">>;
export type ContentExports = Assert<Equal<keyof typeof content,
  "CONTENT_FIELD_KINDS" | "ContentPersistenceError" | "DEFAULT_MARKDOWN_CONTENT_POLICY" | "HOST_CONTENT_OPERATIONS" |
  "assertContentEntryMatchesModel" | "authorizeContentMutation" | "canonicalStringifyJson" | "canonicalizeSiteProject" |
  "compileSiteProjectPlan" | "contentEntryDigest" | "contentEntrySemanticIssue" | "createContentEntryRecord" |
  "diagnoseContentEntryCompleteness" | "diagnoseMarkdownValue" | "isValueValidForField" | "serializeSiteProject" |
  "stripSiteBuildModules" | "traverseContentSchema" | "traverseContentValues" | "validateContentEntryRecord" |
  "validateContentModelRecord" | "validateSiteProject"
>>;
export type HostStorageExports = Assert<Equal<keyof typeof hostStorage,
  "CONTENT_STORAGE_CONFORMANCE_CASES" | "CONTENT_STORAGE_CONFORMANCE_POLICY" | "contentDraftRequestDigest" | "contentSnapshotId" |
  "createContentStorageConformanceBaseline" | "createMemoryContentDraftStorage" | "projectWithContentSnapshot" |
  "runContentStorageConformance" | "sha256Hex" | "applyHostContentRequest" | "createContentEditorStorage" |
  "hostContentRequestDigest" | "isHostContentOperationId" | "readHostContentReceipt"
>>;
export type PreviewProtocolExports = Assert<Equal<keyof typeof previewProtocol,
  "HOST_PREVIEW_CHANNEL" | "HOST_PREVIEW_PROTOCOL_VERSION" | "createHostPreviewBridge" | "hostRenderMessage" |
  "hostRenderMessageSchema" | "hostToPreviewSchema" | "previewErrorMessage" | "previewErrorMessageSchema" |
  "previewReadyMessage" | "previewReadyMessageSchema" | "previewRenderedMessage" | "previewRenderedMessageSchema" |
  "previewToHostSchema" | "readHostToPreview" | "readPreviewToHost" | "sameHostPreviewRequest"
>>;
export type ExportExports = Assert<Equal<keyof typeof exportPublic, "CONTENT_EXPORT_STATES" | "createFakeContentExportAdapter" | "validateContentExportSubmission">>;
export type PortableValidation = Assert<Equal<typeof content.validateSiteProject, typeof authoring.validateSiteProject>>;
export type PortableCanonical = Assert<Equal<typeof content.canonicalStringifyJson, typeof authoring.canonicalStringifyJson>>;
export type PlanIdentity = Assert<Equal<Extract<SiteProjectPlanCompilation, { status: "ready" }>["plan"], SiteProjectPlan>>;
export type PlanHasNoModules = Assert<Equal<"modules" extends keyof SiteProjectPlan ? true : false, false>>;
export type PlanRoutesMatchNodeBuild = Assert<Equal<SiteProjectPlan["routes"][number]["composition"], StaticSiteCompilation["build"]["routes"][number]["composition"]>>;
export type PlanNavigationMatchesNodeBuild = Assert<Equal<SiteProjectPlan["navigation"], StaticSiteCompilation["build"]["navigation"]>>;
export type AuthorizationIsTyped = Assert<Equal<ReturnType<typeof content.authorizeContentMutation>, ContentMutationAuthorization>>;
export type RequestKinds = Assert<Equal<ContentMutationRequest["kind"], "put-entry-values" | "create-entry" | "delete-entry" | "reorder">>;
export type RefusalCodes = Assert<Equal<Extract<ContentMutationAuthorization, { ok: false }>["code"], "malformed-request" | "forbidden" | "wrong-project" | "stale" | "unknown-model" | "unknown-field" | "not-found" | "conflict" | "invalid-value" | "unsafe-reference">>;
export type MemoryStorageIsAdapter = Assert<Equal<Awaited<ReturnType<typeof hostStorage.createMemoryContentDraftStorage>>, ContentDraftStorageAdapter>>;
export type ApplyResult = Assert<Equal<Awaited<ReturnType<ContentDraftStorageAdapter["apply"]>>, ContentDraftMutationResult<ContentDraftApplied>>>;
export type SnapshotResult = Assert<Equal<Awaited<ReturnType<ContentDraftStorageAdapter["snapshot"]>>, ContentDraftMutationResult<ContentSnapshotRecord>>>;
export type ServiceApplyResult = Assert<Equal<Awaited<ReturnType<typeof hostStorage.applyHostContentRequest>>, HostContentApplyResult>>;
export type EditorStorageApply = Assert<Equal<Awaited<ReturnType<ContentEditorStorage["apply"]>>, HostContentApplyResult>>;
export type EditorStorageAccepted = Assert<Equal<ContentEditorStorage extends contentEditor.MountContentEditorOptions["storage"] ? true : false, true>>;
export type EditorMountHandle = Assert<Equal<ReturnType<typeof contentEditor.mountContentEditor>, contentEditor.ContentEditorHandle>>;
export type ContentEditorExports = Assert<Equal<keyof typeof contentEditor,
  "CONTENT_EDITOR_LABELS" | "CONTENT_EDITOR_LABELS_JA" | "HostedContentForbiddenError" | "canSubmitPreviewedSnapshot" |
  "changedEntryValues" | "contentEditorDisplayStatus" | "createContentEditorSession" | "mountContentEditor"
>>;
export type ConformanceFactory = Assert<Equal<Parameters<typeof hostStorage.runContentStorageConformance>[0], (baseline: ContentBaseline) => Promise<ContentDraftStorageAdapter>>>;
export type FakeExportIsAdapter = Assert<Equal<ReturnType<typeof exportPublic.createFakeContentExportAdapter> extends ContentExportAdapter ? true : false, true>>;
export type ExportStates = Assert<Equal<ContentExportStatus["state"], "submitted" | "building" | "verified" | "integrated" | "deployed" | "failed" | "conflict">>;
export type SubmissionKeys = Assert<Equal<keyof ContentExportSubmission, "snapshotId" | "projectRevision" | "baselineRevision" | "packageIdentity" | "idempotencyKey">>;
export type BridgeIdentity = Assert<Equal<ReturnType<typeof previewProtocol.createHostPreviewBridge>, HostPreviewBridge>>;
export type BridgePreviewReturns = Assert<Equal<ReturnType<HostPreviewBridge["preview"]>, HostPreviewRequest | null>>;
export type PreviewMessageTypes = Assert<Equal<PreviewToHostMessage["type"], "ready" | "rendered" | "error">>;
export type EditingOptions = Assert<Equal<Parameters<typeof editing.createEditingService>[0], { workspaceRoot?: string } | undefined>>;
type EditingService = Awaited<ReturnType<typeof editing.createEditingService>>;
export type EditingPlan = Assert<Equal<Awaited<ReturnType<EditingService["plan"]>>, EditPlan>>;
export type EditingReceipt = Assert<Equal<Awaited<ReturnType<EditingService["apply"]>>, EditReceipt>>;
export type EditingRequest = Assert<Equal<EditPlan["request"], EditRequest>>;
export type RootExports = Assert<Equal<keyof typeof rootPublic, "OPTIMIZE_DEPS_EXCLUDE" | "loadHostConfig" | "resolveComposerDevConfig" | "startComposerDevServer">>;
export type ConfigExports = Assert<Equal<keyof typeof configPublic, "defineComposerConfig">>;
export type ViteExports = Assert<Equal<keyof typeof vitePublic,
  "APP_ENTRY_MODULE" | "APP_ROOT" | "COMPONENT_PACK_ID" | "HOST_STYLES_ID" |
  "appModuleId" | "assertPackSourcesResolvable" | "componentPackPlugin" |
  "composerAppHtmlPlugin" | "composerFileProviderPlugin" | "fsModuleId" |
  "hostStylesPlugin" | "loadHostContext" | "resolveComponentPack" |
  "resolveWorkspaceRoot" | "siteProjectSourcePlugin" | "contentEditorPlugins"
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

async function readCatalogUrls(config: ResolvedComposerConfig): Promise<Record<string, string>> {
  const catalogPath = join(config.paths.assets, "catalog.json");
  const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as { records: { id: string; document: { fileName: string; state: "active" | "trash" } }[] };
  return Object.fromEntries(catalog.records.filter((record) => record.document.state === "active").map((record) => [record.document.fileName, authoring.assetAuthoringUrl(record.id)]));
}

export async function readHostAssets(root: string): Promise<Record<string, string>> {
  const fromRoot: ResolvedComposerConfig = await rootPublic.loadHostConfig(root);
  const context = await loadHostContext({ workspaceRoot: root });
  const fromVite: ResolvedComposerConfig = context.composerConfig;
  const options: ComposerDevServerOptions = { workspaceRoot: root, port: 4321, host: true, strictPort: true };
  const resolved = await rootPublic.resolveComposerDevConfig(options);
  const fromServer: ResolvedComposerConfig = resolved.composerConfig;
  return { ...(await readCatalogUrls(fromRoot)), ...(await readCatalogUrls(fromVite)), ...(await readCatalogUrls(fromServer)) };
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

export const policy: HostContentPolicy = { projectId: "host", providerId: "content-filesystem", models: { notes: { fields: ["title"], operations: ["put-entry-values"] } } };
// @ts-expect-error A request cannot carry its own role.
export const privileged: ContentMutationRequest = { kind: "put-entry-values", role: "admin", projectId: "host", providerId: "content-filesystem", modelId: "notes", expectedRevision: 0, entryId: "a", values: {} };
// @ts-expect-error The policy cannot grant an operation outside the fixed set.
export const widened: HostContentPolicy = { ...policy, models: { notes: { fields: ["title"], operations: ["put-model"] } } };
// @ts-expect-error A submission cannot name a repository.
export const steering: ContentExportSubmission = { snapshotId: "", projectRevision: "", baselineRevision: "", packageIdentity: { packId: "x", packVersion: "1", contractVersion: 2 }, idempotencyKey: "k", repository: "x/y" };
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
