import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TrustedComponentPack } from "@zudo-composer/component-contract";
import type { ResolvedComponentPack } from "../../plugins/component-pack.mjs";
import type { ResolvedComposerConfig } from "../config/config";
import type { NativeEditingConfig } from "../config/native-editing";
import { createFilesystemWorkspaceRegistry } from "../../src/app/workspace-filesystem/registry";
import { workspaceDomainRoots } from "../../src/shared/workspace-scope";
import { createFilesystemCompositionStore } from "../../src/composer/storage/filesystem";
import { createFilesystemSitemapStore } from "../../src/sitemapper/storage/filesystem/store";
import { createFilesystemMappingStore } from "../../src/mapping/storage/filesystem/store";
import { createFilesystemContentStore } from "../../src/content/storage/filesystem/store";
import { createFilesystemAssetStore } from "../../src/assets/storage/filesystem/store";
import { createComponentCatalog, type RootPolicy } from "../../src/composer/model/types";
import { indexDocument } from "../../src/composer/model/index-model";
import { resolveGlobalTemplate } from "../../src/composer/reuse/resolver";
import { buildGrammar } from "../../src/composer/grammar";
import type { SitemapNode } from "../../src/sitemapper/model/types";
import { authoredPath } from "../../src/sitemapper/routes/expand";

export interface CaptureHostOptions { config: ResolvedComposerConfig; pack: TrustedComponentPack; packIdentity: ResolvedComponentPack }
async function present(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
async function requireExisting(path: string, directory = false): Promise<void> {
  const stat = await lstat(path).catch(() => { throw new Error(`Native inspection requires existing canonical storage: ${path}. Open a ready workspace first.`); });
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) throw new Error(`Native inspection refuses noncanonical storage: ${path}.`);
}
async function requireExistingRecordStore(root: string): Promise<void> {
  await requireExisting(root, true);
  await requireExisting(join(root, "generations"), true);
  const path = join(root, "current.json");
  await requireExisting(path);
  const pointer: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!pointer || typeof pointer !== "object" || !("entries" in pointer) || !Array.isArray(pointer.entries) || !pointer.entries.some((entry: unknown) => entry && typeof entry === "object" && "id" in entry && entry.id === "meta")) throw new Error(`Canonical storage lacks its metadata marker: ${root}. Explicit recovery is required.`);
}

/** Open only existing stores: inspection must never initialize CMS state. */
export async function captureHost(options: CaptureHostOptions) {
  const { config } = options;
  const registryRoot = join(config.paths.data, "workspaces");
  await requireExistingRecordStore(registryRoot);
  const registry = await createFilesystemWorkspaceRegistry({ registryRoot });
  const generation = await registry.generation();
  const workspaceId = await registry.selection();
  if (!workspaceId) throw new Error("Select a ready workspace before native editing.");
  const workspace = await registry.open(workspaceId);
  if (!workspace || workspace.status !== "ready") throw new Error("Native editing requires a ready selected workspace.");
  const roots = workspaceDomainRoots(config.paths, workspaceId);
  await Promise.all([
    requireExisting(roots.compositions, true),
    ...[roots.sitemaps, roots.mappings, roots.content].map(requireExistingRecordStore),
    requireExisting(config.paths.assets, true), requireExisting(join(config.paths.assets, "versions"), true),
  ]);
  const [compositions, sitemaps, mappings, assets, content] = await Promise.all([
    createFilesystemCompositionStore({ compositionsRoot: roots.compositions, provideJsx: () => { throw new Error("Inspection never generates JSX."); } }),
    createFilesystemSitemapStore({ sitemapsRoot: roots.sitemaps }),
    createFilesystemMappingStore({ mappingsRoot: roots.mappings }),
    createFilesystemAssetStore({ assetsStoreRoot: config.paths.assets }),
    createFilesystemContentStore({ contentRoot: roots.content }),
  ]);
  const [compositionSnapshot, sitemapSnapshot, mappingSnapshot, assetSnapshot, contentSnapshot] = await Promise.all([compositions.snapshot(), sitemaps.snapshot(), mappings.snapshot(), assets.snapshot(), content.readAll()]);
  if (generation !== await registry.generation() || workspaceId !== await registry.selection()) throw new Error("Workspace selection changed during inspection. Retry.");
  return {
    ...options, manifest: createComponentCatalog(options.pack.manifest), workspaceId, workspace,
    sourceAuthored: await present(join(config.workspaceRoot, "site-project.ts")) || await present(join(config.workspaceRoot, "site-project.json")),
    stores: { registry, compositions, sitemaps, mappings, assets, content },
    tokens: { registry: generation, compositions: compositionSnapshot.mutationToken, sitemaps: sitemapSnapshot.mutationToken, mappings: mappingSnapshot.mutationToken, assets: assetSnapshot.mutationToken, content: contentSnapshot.mutationToken },
    records: { compositions: compositionSnapshot.records, sitemaps: sitemapSnapshot.records, mappings: mappingSnapshot.records },
    assets: assetSnapshot,
  };
}
export type HostCapture = Awaited<ReturnType<typeof captureHost>>;
export interface InspectPageRequest { workspaceId: string; page: string; sitemapId?: string }
export type NativeKind = Exclude<keyof NativeEditingConfig, "source">;
export interface NativeTarget { nodeId: string; kind: NativeKind; ordinal: number; componentId: string; props: Record<string, unknown> }

export function nativeCapabilities(config: ResolvedComposerConfig, manifest: HostCapture["manifest"]) {
  const declarations = config.nativeEditing;
  const result: Partial<Record<NativeKind, { available: boolean; componentId: string; reason?: string }>> = {};
  for (const kind of ["paragraph", "list", "image", "table"] as const) {
    const declaration = declarations?.[kind];
    if (!declaration) continue;
    const component = manifest.get(declaration.componentId);
    let reason: string | undefined;
    if (!component) reason = "Declared component is not in the host pack.";
    else for (const [key, prop] of Object.entries(declaration)) {
      if (key === "componentId") continue;
      const field = component.fields.find((field) => field.prop === prop);
      const expected = ["itemsProp", "columnsProp", "rowsProp"].includes(key) ? "array" : "string";
      if (!field || field.schema.type !== expected || component.slots.some((slot) => slot.prop === prop)) reason = `Declared ${key} must name a ${expected} scalar field.`;
    }
    result[kind] = { available: reason === undefined, componentId: declaration.componentId, ...(reason ? { reason } : {}) };
  }
  return result;
}

/** Pure canonical resolution, also used for dependency checks under write barriers. */
export function resolvePage(capture: HostCapture, request: InspectPageRequest) {
  if (request.workspaceId !== capture.workspaceId) throw new Error("Requested workspace is not the selected workspace.");
  if (request.sitemapId === undefined && capture.workspace.metadata.activeSitemap.providerId !== "sitemap-filesystem") throw new Error("Active sitemap belongs to an unsupported provider; select a workspace filesystem sitemap explicitly.");
  const sitemapId = request.sitemapId ?? capture.workspace.metadata.activeSitemap.recordId;
  const sitemap = capture.records.sitemaps.find((record) => record.id === sitemapId);
  if (!sitemap) throw new Error(`Sitemap "${sitemapId}" was not found in the selected workspace.`);
  const flatten = (nodes: readonly SitemapNode[]): SitemapNode[] => nodes.flatMap((node) => [node, ...flatten(node.children)]);
  const routes = (nodes: readonly SitemapNode[], fragments: string[] = [], dynamic = false): { node: SitemapNode; path: string; dynamic: boolean }[] => nodes.flatMap((node) => {
    const next = [...fragments, node.slug ?? ""];
    // Even a direct Composition child inherits a mapping parent's expansion.
    // A node-id selection must not bypass that ownership boundary.
    const isDynamic = dynamic || node.source.kind === "mapping";
    return [{ node, path: authoredPath(next), dynamic: isDynamic }, ...routes(node.children, next, isDynamic)];
  });
  const matches = request.page.startsWith("/")
    ? routes(sitemap.document.root).filter((entry) => !entry.dynamic && entry.path === request.page).map((entry) => entry.node)
    : flatten(sitemap.document.root).filter((node) => node.id === request.page);
  if (matches.length !== 1) throw new Error(`Page "${request.page}" must identify exactly one sitemap node.`);
  const page = matches[0]!;
  if (routes(sitemap.document.root).some((entry) => entry.node.id === page.id && entry.dynamic)) throw new Error("Page belongs to a Mapping subtree; native editing cannot target expanded or inherited mapping routes. Edit its owning source.");
  if (page.source.kind !== "composition") throw new Error(`Page "${page.id}" is ${page.source.kind}; native editing requires a direct composition page. Edit its source through its owning authoring workflow.`);
  if (page.source.ref.providerId !== "files") throw new Error("Native editing supports only the workspace files provider.");
  const record = capture.records.compositions.find((record) => record.id === (page.source.kind === "composition" ? page.source.ref.recordId : undefined));
  if (!record) throw new Error("The page's canonical composition is missing.");
  const consumers = capture.records.sitemaps.flatMap((site) => flatten(site.document.root).filter((node) => node.source.kind === "composition" && node.source.ref.providerId === "files" && node.source.ref.recordId === record.id).map((node) => ({ kind: "page", sitemapId: site.id, pageId: node.id })));
  const mappedDescendants = capture.records.sitemaps.flatMap((site) => routes(site.document.root).filter(({ node, dynamic }) => dynamic && node.source.kind === "composition" && node.source.ref.providerId === "files" && node.source.ref.recordId === record.id).map(({ node }) => ({ sitemapId: site.id, pageId: node.id })));
  const linkedConsumers = capture.records.compositions.filter((candidate) => candidate.document.binding?.sourceRecordId === record.id).map((candidate) => candidate.id);
  const mappedConsumers = capture.records.mappings.filter((candidate) => candidate.document.composition.providerId === "files" && candidate.document.composition.recordId === record.id).map((candidate) => candidate.id);
  const mappedPages = capture.records.sitemaps.flatMap((site) => flatten(site.document.root).filter((node) => node.source.kind === "mapping" && node.source.ref.providerId === "mapping-filesystem" && mappedConsumers.includes(node.source.ref.recordId)).map((node) => ({ sitemapId: site.id, pageId: node.id })));
  const attached = capture.workspace.metadata.collectionAttachments.some((attachment) => attachment.composition.providerId === "files" && attachment.composition.recordId === record.id);
  const writeBlockers: string[] = [];
  if (!capture.config.nativeEditing) writeBlockers.push("Host must explicitly declare nativeEditing with source: workspace.");
  if (capture.sourceAuthored) writeBlockers.push("Source-authored/generated host: edit site-project.ts or site-project.json and regenerate instead.");
  if (consumers.length !== 1 || linkedConsumers.length || mappedConsumers.length || mappedDescendants.length || attached || record.document.publication) writeBlockers.push("Composition is shared, mapped, attached, or published; edit its owning source instead.");
  let rootPolicy: RootPolicy = { kind: "unrestricted" };
  if (record.document.binding) {
    const source = capture.records.compositions.find((candidate) => candidate.id === record.document.binding!.sourceRecordId);
    const resolution = source ? resolveGlobalTemplate({ consumer: record, source, manifest: capture.manifest }) : undefined;
    if (!resolution || resolution.status !== "resolved") { rootPolicy = { kind: "unresolved" }; writeBlockers.push(`Global template binding is unavailable (${resolution?.status ?? "missing-template"}).`); }
    else rootPolicy = resolution.rootPolicy;
  }
  const capabilities = nativeCapabilities(capture.config, capture.manifest);
  const targets: NativeTarget[] = [];
  const counts = { paragraph: 0, list: 0, image: 0, table: 0 };
  const index = indexDocument(record.document, capture.manifest);
  const allTargets = index.order.map((nodeId) => {
    const node = index.byId.get(nodeId)!.node;
    const native = (Object.keys(capabilities) as NativeKind[]).find((kind) => capabilities[kind]?.available && capabilities[kind]?.componentId === node.componentId);
    return { nodeId, componentId: node.componentId, native: native ?? null, ...(native ? {} : { reason: "No supported native editing declaration. Use the component's owning authoring workflow." }) };
  });
  for (const nodeId of index.order) {
    const node = index.byId.get(nodeId)!.node;
    for (const kind of Object.keys(capabilities) as NativeKind[]) if (capabilities[kind]?.available && capabilities[kind]?.componentId === node.componentId) targets.push({ nodeId, kind, ordinal: ++counts[kind], componentId: node.componentId, props: node.props });
  }
  return { record, rootPolicy, targets, allTargets, consumers, linkedConsumers, mappedConsumers, mappedPages, mappedDescendants, writeBlockers, capabilities,
    sitemapId, pageId: page.id,
    identity: { workspaceId: capture.workspaceId, sitemapId, pageId: page.id, providerId: "files", recordId: record.id },
    grammar: buildGrammar({ manifest: capture.manifest, templates: capture.records.compositions.map((record) => record.document) }),
  };
}
export const inspectPage = resolvePage;
