import { acquireAuthoringLease } from "./authoring-lease.mjs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { JsonValue, TrustedComponentPack } from "@zudo-composer/component-contract";
import type { ResolvedComposerConfig } from "../config/config";
import { createFilesystemWorkspaceRegistry } from "../../src/app/workspace-filesystem/registry";
import { createComponentCatalog } from "../../src/composer/model/types";
import { planLinkedJsxModules } from "../../src/composer/source/plan-linked-jsx";
import { createFilesystemCompositionStore } from "../../src/composer/storage/filesystem";
import { createFilesystemContentStore } from "../../src/content/storage/filesystem";
import { createFilesystemMappingStore } from "../../src/mapping/storage/filesystem";
import { createFilesystemSitemapStore } from "../../src/sitemapper/storage/filesystem";
import { workspaceDomainRoots } from "../../src/shared/workspace-scope";
import { canonicalStringifyJson } from "../../src/site-project/model/canonical";
import { validateSiteProject } from "../../src/site-project/model/validation";
import type { SiteProject } from "../../src/site-project/model/types";

/** Trusted host setup: persist authored data through the same stores as the GUI. */
export async function initializeAuthoringWorkspace(options: {
  composerConfig: ResolvedComposerConfig;
  pack: TrustedComponentPack;
  project: SiteProject;
  workspaceId: string;
}) {
  const lease = await acquireAuthoringLease(options.composerConfig.workspaceRoot, "workspace-initializer");
  try {
    return await initialize(options);
  } finally {
    await lease.release();
  }
}

async function initialize(options: Parameters<typeof initializeAuthoringWorkspace>[0]) {
  const { composerConfig, pack, project, workspaceId } = options;
  const validation = validateSiteProject(project, { componentPack: pack.manifest });
  if (!validation.ok) throw new Error(`Invalid authored workspace: ${JSON.stringify(validation.diagnostics)}`);
  const compositionsProvider = project.providers.compositions.find(({ id }) => id === "files");
  const contentProvider = project.providers.content.find(({ id }) => id === "content-filesystem");
  const mappingsProvider = project.providers.mappings.find(({ id }) => id === "mapping-filesystem");
  const sitemapsProvider = project.providers.sitemaps.find(({ id }) => id === "sitemap-filesystem");
  if (!compositionsProvider || !contentProvider || !mappingsProvider || !sitemapsProvider
    || Object.values(project.providers).some((providers) => providers.length !== 1)) {
    throw new Error("Workspace initialization requires exactly the four native filesystem providers.");
  }
  const roots = workspaceDomainRoots(composerConfig.paths, workspaceId);
  const registry = await createFilesystemWorkspaceRegistry({ registryRoot: join(composerConfig.paths.data, "workspaces") });
  const revision = createHash("sha256").update(canonicalStringifyJson(project as unknown as JsonValue)).digest("hex");
  await registry.create(project, revision, workspaceId);
  const catalog = createComponentCatalog(pack.manifest);
  const compositions = await createFilesystemCompositionStore({
    compositionsRoot: roots.compositions,
    provideJsx: (record, request) => {
      const planned = planLinkedJsxModules({
        manifest: catalog, records: request.records,
        sourceOutcomes: new Map(request.sourceOutcomes.map(({ id, outcome }) => [id, outcome])),
        moduleSpecifier: (id) => `./composition-${id}`,
      }).byRecordId.get(record.id);
      if (planned?.status !== "generated") throw new Error(`Cannot generate Composition ${record.id}`);
      return planned.code;
    },
  });
  const templateFirst = (record: typeof compositionsProvider.records[number]) => Number(record.document.publication?.kind === "global-template");
  for (const record of [...compositionsProvider.records].sort((a, b) => templateFirst(b) - templateFirst(a))) {
    const result = await compositions.put(record);
    if (result.derived.status === "blocked") throw new Error(`Blocked Composition ${record.id}`);
  }
  const content = await createFilesystemContentStore({ contentRoot: roots.content });
  await content.seed({ models: contentProvider.models, entries: contentProvider.entries });
  const mappings = await createFilesystemMappingStore({ mappingsRoot: roots.mappings });
  await mappings.seed({ mappings: mappingsProvider.records });
  const sitemaps = await createFilesystemSitemapStore({ sitemapsRoot: roots.sitemaps });
  await sitemaps.seed(sitemapsProvider.records);
  return registry.complete(workspaceId);
}
