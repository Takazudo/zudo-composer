import { afterEach, describe, expect, it } from "vitest";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadHostContext } from "../../host-context.mjs";
import { initializeAuthoringWorkspace } from "../initialize-workspace";
import { createEditingService, editDigest, type EditRequest } from "../service";
import { acquireAuthoringLease } from "../authoring-lease.mjs";
import { captureHost } from "../inspect";
import { defineSite, node } from "../../../src/site-project/authoring";
import { createFilesystemAssetStore } from "../../../src/assets/storage/filesystem/store";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(prose = false, variant?: "bound" | "defaults" | "wrapper") {
  const root = await mkdtemp(join(tmpdir(), "native-service-")); roots.push(root);
  await cp(resolve("fixtures/edit-host"), root, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "native-edit-host", version: "1.0.0", type: "module", exports: { "./components": "./components/pack.mjs" }, dependencies: { preact: "10.27.2", "@zudo-composer/component-contract": "workspace:*" } }));
  await mkdir(join(root, "node_modules/@zudo-composer"), { recursive: true });
  await symlink(resolve("."), join(root, "node_modules/zudo-composer"), "dir");
  await symlink(resolve("node_modules/preact"), join(root, "node_modules/preact"), "dir");
  await symlink(resolve("node_modules/@zudo-composer/component-contract"), join(root, "node_modules/@zudo-composer/component-contract"), "dir");
  if (prose) {
    const packPath = join(root, "components/pack.mjs");
    const source = await readFile(packPath, "utf8");
    await writeFile(packPath, source.replace('export const Paragraph', 'export const ProseMd = ({ markdown }) => h("div", {}, markdown);\nexport const Paragraph').replace('components: [', 'components: [component(ProseMd, "native.prose", "ProseMd", { markdown: "" }, [{ prop: "markdown", label: "Markdown", ...string }]),'));
  }
  if (variant) {
    const packPath = join(root, "components/pack.mjs");
    let source = await readFile(packPath, "utf8");
    if (variant === "bound") source = source.replace('export const Paragraph', 'export const Shell = ({ children }) => h("main", {}, children);\nexport const Paragraph').replace('components: [', 'components: [defineComponent()(Shell, { id: "native.shell", schemaVersion: 1, title: "Shell", category: "Test", description: "Restricted page root", source: { module: "native-edit-host/components", exportKind: "named", exportName: "Shell" }, defaults: {}, fields: [], slots: [{ id: "body", prop: "children", label: "Body", cardinality: "many", accepts: ["native.paragraph", "native.list", "native.table"] }] }),');
    if (variant === "defaults") source = source.replace('{ text: "" }, [{ prop: "text", label: "Text", ...string }]', '{ text: "", caption: "Unrequested caption" }, [{ prop: "text", label: "Text", ...string }, { prop: "caption", label: "Caption", ...string }]');
    if (variant === "wrapper") source = source.replace('defaults, fields,', 'defaults, fields, ...(id === "native.paragraph" ? { slots: [{ id: "children", prop: "children", label: "Children", cardinality: "many" }] } : {}),');
    await writeFile(packPath, source);
  }
  const host = await loadHostContext({ workspaceRoot: root });
  const options = { config: host.composerConfig, pack: host.pack, packIdentity: host.packIdentity };
  const site = defineSite({ id: "native-edit-proof", name: "Proof", componentPack: host.pack });
  const template = variant === "bound" ? site.template({ id: "shell", name: "Shell", root: [node("native.shell", {}, { body: [] }, "shell-root")], outlet: { target: { parentId: "shell-root", slotId: "body" } } }) : undefined;
  const home = site.page({ id: "home", name: "Home", ...(template ? { template } : {}), root: [
    node("native.paragraph", { text: "Original 日本語" }, {}, "paragraph"),
    node("native.list", { items: ["One", "Two"] }, {}, "list"),
    node("native.table", { columns: ["Name", "Value"], rows: [["Alpha", "Before"]] }, {}, "table"),
    ...(prose ? [node("native.prose", { markdown: "First paragraph.\n\nSecond paragraph." }, {}, "prose")] : []),
  ] });
  site.sitemap({ id: "main", name: "Main", root: { id: "home", title: "Home", page: home } });
  await initializeAuthoringWorkspace({ composerConfig: host.composerConfig, pack: host.pack, project: site.toSiteProject(), workspaceId: "proof" });
  const assets = await createFilesystemAssetStore({ assetsStoreRoot: host.composerConfig.paths.assets });
  const asset = await assets.upload({ fileName: "pixel.png", declaredMimeType: "image/png", bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=", "base64") });
  return { root, options, service: createEditingService(options), asset, assets, project: site.toSiteProject() };
}
const request: EditRequest = { workspaceId: "proof", page: "/", after: { nodeId: "paragraph" }, insert: { kind: "text", text: "追加の日本語。\n二行目もそのまま。" } };
const approval = (plan: { id: string; digest: string }) => ({ planId: plan.id, approve: plan.digest });

 describe("reviewed native editing service", () => {
  it("plans without altering canonical tokens and applies exact Japanese insertion once with guarded undo", async () => {
    const { service, options } = await fixture();
    const before = await captureHost(options);
    const plan = await service.plan(request);
    expect((await captureHost(options)).tokens).toEqual(before.tokens);
    expect(plan.candidate.document.root.map(node => node.id)).toEqual(["paragraph", plan.generatedId, "list", "table"]);
    expect(plan.candidate.document.root[1]!.props).toEqual({ text: request.insert.kind === "text" ? request.insert.text : "" });
    expect(await service.review({ planId: plan.id })).toEqual(plan);
    const receipt = await service.apply(approval(plan));
    expect(await service.apply(approval(plan))).toEqual(receipt);
    expect((await captureHost(options)).records.compositions[0]).toEqual(plan.candidate);
    await service.undo(approval(plan));
    expect((await captureHost(options)).records.compositions).toEqual(before.records.compositions);
  });
  it("inserts only supplied table cells and exact managed image pin", async () => {
    const { service, options, asset } = await fixture();
    const table = await service.plan({ ...request, after: { kind: "list", ordinal: 1 }, insert: { kind: "table", columns: ["項目", "値"], rows: [["一", "二"], ["三", "四"]] } });
    expect(table.candidate.document.root[2]!.props).toEqual({ columns: ["項目", "値"], rows: [["一", "二"], ["三", "四"]] });
    await service.apply(approval(table));
    const image = await service.plan({ ...request, after: { nodeId: "table" }, insert: { kind: "image", assetId: asset.id, alt: "指定された説明" } });
    expect(image.candidate.document.root.at(-1)!.props).toEqual({ src: image.assetPin!.url, alt: "指定された説明" });
    await service.apply(approval(image));
    expect((await captureHost(options)).records.compositions[0]).toEqual(image.candidate);
    await expect(service.undo(approval(table))).rejects.toMatchObject({ code: "undo-conflict" });
  });
  it("rejects malformed requests and missing native targets without canonical changes", async () => {
    const { service, options } = await fixture(); const before = (await captureHost(options)).tokens;
    for (const input of [{ ...request, extra: true }, { ...request, operations: [request] }, { ...request, after: { nodeId: "missing" } }, { ...request, insert: { kind: "text", text: "x", componentId: "unknown" } }, { ...request, insert: { kind: "table", columns: ["A"], rows: [["x", "y"]] } }, { ...request, workspaceId: "other" }]) await expect(service.plan(input)).rejects.toThrow();
    expect((await captureHost(options)).tokens).toEqual(before);
  });
  it("rejects digest mismatch, tampering, discarded and superseded plans", async () => {
    const { service, root, options } = await fixture();
    const untouched = (await captureHost(options)).tokens;
    const first = await service.plan(request);
    await expect(service.apply({ planId: first.id, approve: "0".repeat(64) })).rejects.toMatchObject({ code: "approval-mismatch" });
    await service.discard({ planId: first.id });
    await expect(service.apply(approval(first))).rejects.toMatchObject({ code: "inactive-plan" });
    const old = await service.plan(request), replacement = await service.plan(request);
    await service.supersede({ planId: old.id, replacementPlanId: replacement.id });
    await expect(service.apply(approval(old))).rejects.toMatchObject({ code: "inactive-plan" });
    const path = join(root, "cms/edit-plans", `${replacement.id}.plan.json`);
    const stored = JSON.parse(await readFile(path, "utf8")); stored.candidate.document.name = "Tampered";
    await writeFile(path, JSON.stringify(stored));
    await expect(service.apply(approval(replacement))).rejects.toMatchObject({ code: "tampered-plan" });
    expect((await captureHost(options)).tokens).toEqual(untouched);
  });

  it("rejects a rehashed plan with a substituted before record or owner", async () => {
    const { service, root, options } = await fixture();
    for (const alter of ["before", "identity"] as const) {
      const plan = await service.plan(request);
      const path = join(root, "cms/edit-plans", `${plan.id}.plan.json`);
      const stored = JSON.parse(await readFile(path, "utf8"));
      if (alter === "before") stored.before.document.name = "Fabricated prior content";
      else stored.identity.pageId = "other-owner";
      const unsigned = { ...stored }; delete unsigned.digest;
      stored.digest = editDigest(unsigned);
      await writeFile(path, JSON.stringify(stored));
      const before = (await captureHost(options)).tokens;
      await expect(service.apply({ planId: plan.id, approve: stored.digest })).rejects.toMatchObject({ code: "tampered-plan" });
      expect((await captureHost(options)).tokens).toEqual(before);
    }
  });

  it("enforces the bound template root acceptance policy and its revision", async () => {
    const { service, options, asset } = await fixture(false, "bound");
    const before = (await captureHost(options)).tokens;
    await expect(service.plan({ ...request, insert: { kind: "image", assetId: asset.id, alt: "Outside root accepts" } })).rejects.toMatchObject({ code: "component-invalid" });
    expect((await captureHost(options)).tokens).toEqual(before);
    const happy = await service.plan(request);
    await service.apply(approval(happy));
    await service.undo(approval(happy));
    const plan = await service.plan(request);
    const state = await captureHost(options), source = structuredClone(state.records.compositions.find(record => record.id === "shell")!);
    source.document.name = "Changed bound template";
    await writeFile(join(options.config.paths.compositions, "workspace-v1-proof", "composition-shell.composition.json"), JSON.stringify(source));
    const changed = (await captureHost(options)).tokens;
    await expect(service.apply(approval(plan))).rejects.toMatchObject({ code: "stale-plan" });
    expect((await captureHost(options)).tokens).toEqual(changed);
  });
  it.each(["defaults", "wrapper"] as const)("refuses %s that would introduce unsolicited content or structure", async (variant) => {
    const { service, options } = await fixture(false, variant);
    const before = (await captureHost(options)).tokens;
    await expect(service.plan(request)).rejects.toMatchObject({ code: "unsupported-capability" });
    expect((await captureHost(options)).tokens).toEqual(before);
  });
  it("rejects changed stylesheet dependencies", async () => {
    const { service, root } = await fixture();
    const plan = await service.plan(request);
    await writeFile(join(root, "styles/base.css"), "p { color: red; }\n");
    await expect(service.apply(approval(plan))).rejects.toMatchObject({ code: "stale-plan" });
  });

  it("rejects moved anchors and asset changes instead of rebasing approvals", async () => {
    const { service, options, assets } = await fixture();
    const plan = await service.plan(request);
    const state = await captureHost(options), record = structuredClone(state.records.compositions[0]!);
    [record.document.root[0], record.document.root[1]] = [record.document.root[1]!, record.document.root[0]!];
    const canonical = join(options.config.paths.compositions, "workspace-v1-proof", "composition-home.composition.json");
    await writeFile(canonical, JSON.stringify(record));
    await expect(service.apply(approval(plan))).rejects.toMatchObject({ code: "stale-plan" });
    const fresh = await service.plan(request);
    await assets.upload({ fileName: "new.txt", declaredMimeType: "text/plain", bytes: Buffer.from("asset catalog changed") });
    await expect(service.apply(approval(fresh))).rejects.toMatchObject({ code: "stale-plan" });
  });

  it("refuses another selected workspace at apply", async () => {
    const { service, options, project } = await fixture();
    const plan = await service.plan(request);
    await initializeAuthoringWorkspace({ composerConfig: options.config, pack: options.pack, project, workspaceId: "different" });
    await expect(service.apply(approval(plan))).rejects.toMatchObject({ code: "wrong-workspace" });
  });
  it("rejects changed component source and unavailable declared components", async () => {
    const { service, root } = await fixture();
    const plan = await service.plan(request);
    const packPath = join(root, "components/pack.mjs");
    await writeFile(packPath, (await readFile(packPath, "utf8")) + "\n// Changed component source.\n");
    await expect(service.apply(approval(plan))).rejects.toMatchObject({ code: "stale-plan" });
    const configPath = join(root, "zudo-composer.config.ts");
    await writeFile(configPath, (await readFile(configPath, "utf8")).replace('componentId: "native.table"', 'componentId: "missing.table"'));
    await expect(service.plan({ ...request, insert: { kind: "table", columns: ["A"], rows: [["B"]] } })).rejects.toMatchObject({ code: "unsupported-capability" });
  });

  it("requires a separate exact approval and refuses a held authoring lease", async () => {
    const { service, root, options } = await fixture();
    const plan = await service.plan(request), before = (await captureHost(options)).tokens;
    await expect(service.apply({ planId: plan.id })).rejects.toMatchObject({ code: "invalid-request" });
    const lease = await acquireAuthoringLease(root, "test-browser");
    try {
      await expect(service.apply(approval(plan))).rejects.toMatchObject({ code: "authoring-busy" });
      await expect(service.plan(request)).rejects.toMatchObject({ code: "authoring-busy" });
    } finally { await lease.release(); }
    expect((await captureHost(options)).tokens).toEqual(before);
  });
  it("concurrent duplicate applications have one writer and no duplicate insertion", async () => {
    const { service, options } = await fixture();
    const plan = await service.plan(request);
    const outcomes = await Promise.allSettled([service.apply(approval(plan)), service.apply(approval(plan))]);
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find(outcome => outcome.status === "rejected")).toMatchObject({ reason: { code: "authoring-busy" } });
    expect((await captureHost(options)).records.compositions[0]!.document.root.filter(node => node.id === plan.generatedId)).toHaveLength(1);
    await expect(service.apply(approval(plan))).resolves.toMatchObject({ planId: plan.id });
  });
  it("reports ProseMd as unsupported and never guesses its internal paragraph", async () => {
    const { service } = await fixture(true);
    const page = await service.inspect({ workspaceId: "proof", page: "/" });
    expect(page.allTargets.find(target => target.nodeId === "prose")).toMatchObject({ native: null });
    await expect(service.plan({ ...request, after: { nodeId: "prose" } })).rejects.toMatchObject({ code: "unsupported-target" });
    await expect(service.plan({ ...request, after: { kind: "paragraph", ordinal: 2 } })).rejects.toMatchObject({ code: "unsupported-target" });
  });
  it("refuses undeclared host authority and mapped composition consumers", async () => {
    const { options, service, root } = await fixture();
    const configPath = join(root, "zudo-composer.config.ts"), original = await readFile(configPath, "utf8");
    await writeFile(configPath, 'export default { pack: "native-edit-host/components" };\n');
    await expect(service.plan(request)).rejects.toMatchObject({ code: "unsupported-scope" });
    await writeFile(configPath, original);
    const state = await captureHost(options);
    await state.stores.mappings.put({ id: "mapping", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", document: { schemaVersion: 2, id: "mapping", name: "Mapping", contentModel: { providerId: "content-filesystem", recordId: "model" }, composition: { providerId: "files", recordId: "home" }, mode: { kind: "single" }, bindings: [] } });
    await expect(service.plan(request)).rejects.toMatchObject({ code: "unsupported-scope" });
  });
  it("refuses source-authored and shared owners with actionable inspection", async () => {
    const { service, root, options } = await fixture();
    await writeFile(join(root, "site-project.ts"), "export default {};\n");
    expect((await service.inspect({ workspaceId: "proof", page: "/" })).writeBlockers.join(" ")).toMatch(/Source-authored/);
    await expect(service.plan(request)).rejects.toMatchObject({ code: "unsupported-scope" });
    await rm(join(root, "site-project.ts"));
    const state = await captureHost(options), sitemap = structuredClone(state.records.sitemaps[0]!);
    sitemap.document.root[0]!.children.push({ ...sitemap.document.root[0]!, id: "shared", slug: "shared", children: [] });
    await state.stores.sitemaps.put(sitemap);
    await expect(service.plan(request)).rejects.toMatchObject({ code: "unsupported-scope" });
  });
 });
