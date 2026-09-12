import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { TrustedComponentPack } from "@zudo-composer/component-contract";
import type { ResolvedComposerConfig } from "../server/config/config";
import { resolveWorkspaceRegistryRoot } from "../plugins/workspace-domain-provider.mjs";
import { createWorkspaceRegistryService } from "../src/app/workspace-filesystem/dev-server-entry";
import { createComponentCatalog } from "../src/composer/model/types";
import { planLinkedJsxModules } from "../src/composer/source/plan-linked-jsx";
import { createFilesystemCompositionStore } from "../src/composer/storage/filesystem";
import { createFilesystemContentStore } from "../src/content/storage/filesystem";
import { createFilesystemMappingStore } from "../src/mapping/storage/filesystem";
import { createFilesystemSitemapStore } from "../src/sitemapper/storage/filesystem";
import { workspaceDomainRoots } from "../src/shared/workspace-scope";

/**
 * Open every persisted record with the same readers used by the application.
 * Call only after the inventory has been checked for missing paths/symlinks.
 * Reads run on a disposable copy: Composer may repair derived JSX on a read,
 * and an empty transactional store may initialize itself while opening.
 */
export async function readCmsFixture(options: {
  root: string;
  config: ResolvedComposerConfig;
  pack: TrustedComponentPack;
  managedRoots: readonly string[];
}): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), "cms-fixture-readers-"));
  const { root, config, pack, managedRoots } = options;
  const map = (path: string) => join(temporary, relative(config.workspaceRoot, path));
  try {
    for (const path of managedRoots) await cp(join(root, path), join(temporary, path), { recursive: true, errorOnExist: true, force: false });
    const domainRoots = {
      compositions: map(config.paths.compositions), content: map(config.paths.content),
      mappings: map(config.paths.mappings), sitemaps: map(config.paths.sitemaps),
    };
    const registry = await createWorkspaceRegistryService({
      registryRoot: map(resolveWorkspaceRegistryRoot(config.paths.data)), domainRoots,
    });
    const records = await registry.list();
    const selected = await registry.open();
    if (!records.length || !selected || selected.status !== "ready") throw new Error("The committed registry has no selected ready workspace.");
    for (const record of records) {
      if (record.status !== "ready" || "seed" in record || "requiresBeforeComplete" in record || "seedCleanupPending" in record) {
        throw new Error(`Workspace ${record.id} was not completed.`);
      }
      const missing = await registry.missingDirectories(record.id);
      if (missing.length) throw new Error(`Workspace ${record.id} is missing directories: ${missing.join(", ")}.`);
      const scoped = workspaceDomainRoots(domainRoots, record.id);
      const catalog = createComponentCatalog(pack.manifest);
      const compositions = await createFilesystemCompositionStore({
        compositionsRoot: scoped.compositions,
        provideJsx: (composition, request) => {
          const planned = planLinkedJsxModules({
            manifest: catalog, records: request.records,
            sourceOutcomes: new Map(request.sourceOutcomes.map(({ id, outcome }) => [id, outcome])),
            moduleSpecifier: (id) => `./composition-${id}`,
          }).byRecordId.get(composition.id);
          if (planned?.status !== "generated") throw new Error(`Composition ${composition.id} has blocked JSX: ${JSON.stringify(planned)}`);
          return planned.code;
        },
      });
      // list() omits invalid canonical records. Enumerate files and require
      // get() to accept each one, including a future-schema record.
      for (const name of (await readdir(scoped.compositions)).sort()) {
        const match = /^composition-(.+)\.composition\.json$/.exec(name);
        if (!match) continue;
        const outcome = await compositions.get(match[1]!);
        if (outcome.status !== "loaded") throw new Error(`Composition ${name} was rejected: ${JSON.stringify(outcome)}`);
      }
      await (await createFilesystemContentStore({ contentRoot: scoped.content })).readAll();
      await (await createFilesystemMappingStore({ mappingsRoot: scoped.mappings })).readAll();
      await (await createFilesystemSitemapStore({ sitemapsRoot: scoped.sitemaps })).readAll();
    }
  } catch (cause) {
    throw new Error(`Current CMS readers rejected ${config.workspaceRoot}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
