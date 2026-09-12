import * as authoring from "zudo-composer/authoring";
import { compileStaticSite, type StaticSiteCompilation, type SiteManifest } from "zudo-composer/site-build";
import { loadHostContext, type HostContext, type ResolvedComponentPack } from "zudo-composer/vite";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
export type AuthoringExports = Assert<Equal<keyof typeof authoring, "assetAuthoringUrl" | "assetMimeTypeForExtension" | "createFilesystemAssetStore" | "canonicalStringifyJson" | "validateSiteProject">>;
export type CompilationReturn = Assert<Equal<Awaited<ReturnType<typeof compileStaticSite>>, StaticSiteCompilation>>;
export type ContextReturn = Assert<Equal<Awaited<ReturnType<typeof loadHostContext>>, HostContext>>;
export type PackIdentity = Assert<Equal<HostContext["packIdentity"], ResolvedComponentPack>>;
export type ValidationIsTyped = Assert<Equal<ReturnType<typeof authoring.validateSiteProject>["ok"], boolean>>;

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
