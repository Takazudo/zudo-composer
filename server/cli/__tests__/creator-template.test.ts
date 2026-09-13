import { execFile } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { runnerImport } from "vite";
import { expect, it } from "vitest";
import ts from "typescript";
import type { TrustedComponentPack } from "@zudo-composer/component-contract";
import { APP_ROOT } from "../../../plugins/roots.mjs";
import { scanConsumerHost } from "../../../scripts/check-consumer-boundary.mjs";
import { createWorkspaceRegistryService } from "../../../src/app/workspace-filesystem/dev-server-entry";
import { composer } from "../../config/config";
import { readCreatorMetadata, writeHostProject } from "../../creator/project.mjs";
import { initHostProject, type InitCommand } from "../../creator/init.mjs";
import { createAssetImportService } from "../assets-import-service";
import { generateSiteProject } from "../generate";
import { produceReadyWorkspace } from "../ready-workspace";

// This bounded source test exercises the real canonical writers and every
// starter record. Its module evaluator reuses repository dependencies; actual
// installed init/bootstrap and fresh-clone proof belong to the packed lane.
it("produces a complete portable starter through canonical writers and reopens its selected ready workspace", async () => {
  const parent = join(APP_ROOT, ".artifacts");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "creator-template-"));
  const host = join(root, "host");
  try {
    const metadata = await readCreatorMetadata();
    await writeHostProject(host, "creator-contract", metadata);
    // Typecheck the actual emitted host configs and tests. Only public package
    // resolution is supplied by this source lane; these paths are never written
    // to the host. The packed lane repeats this with ordinary installed lookup.
    const tsconfig = ts.readConfigFile(join(host, "tsconfig.json"), ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(tsconfig.config, ts.sys, host, {
      paths: Object.fromEntries(["authoring", "site-build", "site-project"].map((name) => [`zudo-composer/${name}`, [join(APP_ROOT, `server/${name}.d.mts`)]]).concat([["zudo-composer/config", [join(APP_ROOT, "server/config/define.d.mts")]]])),
    });
    const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(ts.createProgram(parsed.fileNames, parsed.options))];
    expect(diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
    const evaluate = async (path: string) => (await runnerImport(pathToFileURL(path).href, {
      configFile: false, root: host,
      resolve: { alias: { "zudo-composer/authoring": join(APP_ROOT, "server/authoring.mjs") }, dedupe: ["preact"] },
      oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
    })).module as Record<string, unknown>;
    const pack = (await evaluate(join(host, "components/pack.ts"))).componentPack as TrustedComponentPack;
    const config = composer({ workspaceRoot: host, pack: "creator-contract/components" }, { env: {} });
    await generateSiteProject({ packageRoot: host, componentPack: pack.manifest, evaluate });
    expect(await createAssetImportService(config).handle({ manifest: "images-src/manifest.json" }))
      .toEqual({ ok: true, result: { added: 1, skipped: 0 } });
    const project = JSON.parse(await readFile(join(host, "site-project.json"), "utf8"));
    const options = { config, pack, packIdentity: { specifier: "creator-contract/components", packageName: "creator-contract", packageRoot: host, entryPath: join(host, "components/pack.ts") } };
    const result = await produceReadyWorkspace(project, options);
    expect(result.status).toBe("created");
    await cp(join(host, "cms/assets/versions"), join(host, "public/uploaded-assets"), { recursive: true });
    const registry = await createWorkspaceRegistryService({ registryRoot: join(host, "cms/workspaces"), domainRoots: config.paths });
    expect(await registry.open()).toMatchObject({ status: "ready", baselineRevision: result.revision });
    expect(await registry.selection()).toBe("initial");
    expect(await registry.missingDirectories("initial")).toEqual([]);
    expect((await produceReadyWorkspace(project, options)).status).toBe("unchanged");
    await expect(lstat(join(host, ".zudo-site-project"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(scanConsumerHost({ root: host, hostRoot: host })).toEqual([]);

    // These are the exact starter counterparts of #545's complete retained
    // runtime, authoring/build, and tests/types/docs categories.
    const required = JSON.parse(await readFile(join(APP_ROOT, "scripts/creator-required-files.json"), "utf8")) as Record<string, string[]>;
    const inventory: string[] = [];
    const walk = async (part = "") => {
      for (const entry of await readdir(join(host, part), { withFileTypes: true })) {
        const path = [part, entry.name].filter(Boolean).join("/");
        if (entry.isDirectory()) await walk(path);
        else {
          inventory.push(path);
          // Binary source/public copies contain no embedded paths. All
          // generated text must also remain portable after moving the tree.
          if (!path.endsWith(".png")) expect(await readFile(join(host, path), "utf8")).not.toContain(resolve(root));
        }
      }
    };
    await walk();
    expect(inventory.sort()).toEqual(Object.values(required).flat().sort());

    // Exercise publication and preview cleanup with the real writer-produced
    // payload above. Only network installation/process execution is replaced
    // here; the separate packed lane proves those boundaries end to end.
    const archives: string[] = [];
    for (const [index, packageName, version] of [[0, "zudo-composer", metadata.tool.version], [1, "@zudo-composer/component-contract", metadata.contractVersion]] as const) {
      const archiveRoot = join(root, `archive-${index}`);
      await mkdir(join(archiveRoot, "package"), { recursive: true });
      await writeFile(join(archiveRoot, "package/package.json"), JSON.stringify({ name: packageName, version }));
      const path = join(root, `${index}.tgz`);
      await promisify(execFile)("tar", ["-czf", path, "package"], { cwd: archiveRoot });
      archives.push(path);
    }
    const invocationOrder: string[] = [];
    const concurrent = { target: undefined as string | undefined };
    const run: InitCommand = async (binary, args, { cwd }) => {
      if (binary === "corepack") {
        invocationOrder.push("install");
        for (const [packageName, version] of [["zudo-composer", metadata.tool.version], ["@zudo-composer/component-contract", metadata.contractVersion]]) {
          const path = join(cwd, "node_modules", packageName);
          await mkdir(path, { recursive: true });
          await writeFile(join(path, "package.json"), JSON.stringify({ name: packageName, version }));
        }
        await writeFile(join(cwd, "pnpm-lock.yaml"), `temporary-override: ${cwd}\n`);
      } else {
        expect(binary).toBe(process.execPath);
        expect(args[0]).toBe(join(cwd, "node_modules/zudo-composer/bin/zudo-composer.mjs"));
        invocationOrder.push(args.slice(1).join(" "));
        if (args[1] === "generate") await cp(join(host, "site-project.json"), join(cwd, "site-project.json"));
        if (args[1] === "assets") await cp(join(host, "cms/assets"), join(cwd, "cms/assets"), { recursive: true });
        if (args[1] === "seed") {
          for (const directory of ["compositions", "content", "mappings", "sitemaps", "workspaces"]) {
            await cp(join(host, "cms", directory), join(cwd, "cms", directory), { recursive: true });
          }
          if (concurrent.target) {
            await mkdir(concurrent.target);
            await writeFile(join(concurrent.target, "user.txt"), "Preserve concurrent user data");
          }
        }
      }
      return "";
    };
    const target = join(root, "created host");
    const initOptions = { target, name: "creator-contract", toolTarball: archives[0], contractTarball: archives[1] };
    expect(await initHostProject(initOptions, { run })).toMatchObject({ directory: target, preview: true, populated: true });
    expect(invocationOrder).toEqual(["install", "generate", "assets import images-src/manifest.json", "seed --ready-workspace"]);
    expect(scanConsumerHost({ root: target, hostRoot: target })).toEqual([]);
    for (const path of inventory) expect(await readFile(join(target, path))).toEqual(await readFile(join(host, path)));
    for (const path of ["pnpm-lock.yaml", "node_modules", ".zudo-site-project"]) await expect(lstat(join(target, path))).rejects.toMatchObject({ code: "ENOENT" });
    concurrent.target = join(root, "concurrent-target");
    await expect(initHostProject({ ...initOptions, target: concurrent.target }, { run })).rejects.toThrow("existing path was preserved");
    expect(await readFile(join(concurrent.target, "user.txt"), "utf8")).toBe("Preserve concurrent user data");
  } finally { await rm(root, { recursive: true, force: true }); }
});
