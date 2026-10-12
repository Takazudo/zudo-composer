import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { defineComponent, defineComponentPack } from "@zudo-composer/component-contract";
import { composer } from "../../config/config";
import { initializeAuthoringWorkspace } from "../../edit/initialize-workspace";
import { defineSite, node } from "../../../src/site-project/authoring";
import { createFilesystemWorkspaceRegistry } from "../../../src/app/workspace-filesystem/registry";
import { createFilesystemCompositionStore } from "../../../src/composer/storage/filesystem";
import { workspaceDomainRoots } from "../../../src/shared/workspace-scope";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
it("initializes canonical records and linked JSX that a fresh workspace reader can reopen", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "native-workspace-")); roots.push(workspaceRoot);
  const pack = defineComponentPack({ packId: "native-proof", packVersion: "1.0.0", components: [defineComponent<{ text: string }>()((props: { text: string }) => props.text, {
    id: "paragraph", schemaVersion: 1, title: "Paragraph", description: "Proof", category: "Proof",
    source: { module: "native-proof/components", exportKind: "named", exportName: "Paragraph" },
    defaults: { text: "" }, fields: [{ kind: "text", prop: "text", label: "Text" }],
  })] });
  const composerConfig = composer({ workspaceRoot, pack: "native-proof/components" }, { env: {} });
  const site = defineSite({ id: "proof", name: "Proof", componentPack: pack });
  const page = site.page({ id: "home", name: "Home", root: [node("paragraph", { text: "Canonical text" }, {}, "paragraph")] });
  site.sitemap({ id: "main", name: "Main", root: { id: "home", title: "Home", page } });
  const project = site.toSiteProject();
  const ready = await initializeAuthoringWorkspace({ composerConfig, pack, project, workspaceId: "proof" });
  expect(ready.status).toBe("ready");
  const registry = await createFilesystemWorkspaceRegistry({ registryRoot: join(composerConfig.paths.data, "workspaces") });
  expect(await registry.selection()).toBe("proof");
  const scoped = workspaceDomainRoots(composerConfig.paths, "proof");
  const store = await createFilesystemCompositionStore({ compositionsRoot: scoped.compositions, provideJsx: () => { throw new Error("Read must not regenerate"); } });
  expect((await store.snapshot()).records).toEqual(project.providers.compositions[0]!.records);
  await expect(initializeAuthoringWorkspace({ composerConfig, pack, project, workspaceId: "proof" })).rejects.toThrow();
});
