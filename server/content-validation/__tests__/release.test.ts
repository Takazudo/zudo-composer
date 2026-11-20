import { resolveLocalReleaseToolchain } from "../../site-project-local/toolchain-config";
import { readActivatedContentRelease, readActivatedSiteRelease } from "../../site-project-local/dev-reader";
import { createFilesystemContentStore } from "../../../src/content/storage/filesystem/store";
import { runContentEditorial } from "../../../src/content/storage/file-provider/dev-server-entry";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createLocalSiteProjectApiService } from "../../site-project-local/service";
import { createLocalSiteProjectStore } from "../../site-project-local/store";
import { call, pack, review, toolchain } from "../../site-project-local/__tests__/release-fixture";
import { project, entry } from "../../../src/site-project/compiler/__tests__/fixtures";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "release-policy-")); roots.push(root);
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "release-policy", type: "module", exports: { "./policy": "./policy.mjs" } }));
  await writeFile(join(root, "zudo-composer.config.ts"), "export default {pack:'release-policy/pack', contentValidation:{module:'release-policy/policy',id:'policy',version:'1'}};");
  await writeFile(join(root, "policy.mjs"), "export const validateContentField = ({field,value}) => field.id==='title' && value==='invalid' ? [{code:'invalid-title',message:'Title violates host policy'}] : [];\n");
  const options = { workspaceRoot: root, pack, toolchain };
  return { root, options, service: createLocalSiteProjectApiService(options) };
}
const selection = [{ ref: { providerId: "content-filesystem", modelId: "articles", recordId: "selected" }, action: "publish" as const }];
it("refuses selected historical invalid draft at plan, preserves unrelated invalid drafts, publishes allowed selected record", async () => {
  const { service } = await fixture();
  const invalid = { ...entry("selected", "invalid"), lifecycle: "draft" as const };
  await expect(review(service, project({ entries: [invalid] }), { selection })).rejects.toThrow("Title violates host policy");
  const allowed = { ...invalid, values: { ...invalid.values, title: "Allowed" } };
  const unrelated = { ...entry("unrelated", "invalid"), lifecycle: "draft" as const };
  const plan = await review(service, project({ entries: [allowed, unrelated] }), { selection });
  expect(plan.candidate.providers.content[0]!.entries.map(value => value.id)).toEqual(["selected"]);
  await call(service, "apply", { plan });
  await call(service, "build", { projectId: plan.candidate.id, buildId: plan.buildId });
  const active = await call<{ active: unknown }>(service, "activate", { projectId: plan.candidate.id, revision: plan.projectRevision, buildId: plan.buildId, expectedActive: null });
  expect(active.active).toEqual({ projectId: plan.candidate.id, revision: plan.projectRevision, buildId: plan.buildId });
});
it("source changes after build refuse new activation but retained release reads still work", async () => {
  const { root, options, service } = await fixture();
  const plan = await review(service, project({ entries: [{ ...entry("selected", "Allowed"), lifecycle: "draft" }] }), { selection });
  await call(service, "apply", { plan });
  await call(service, "build", { projectId: plan.candidate.id, buildId: plan.buildId });
  await writeFile(join(root, "policy.mjs"), "export const validateContentField = () => []; // changed\n");
  await expect(call(service, "activate", { projectId: plan.candidate.id, revision: plan.projectRevision, buildId: plan.buildId, expectedActive: null })).rejects.toThrow("Restart authoring");
  // A restart loads the new valid policy; the old immutable stage still binds the old digest.
  const request = { protocolVersion: 2, operation: "activate", projectId: plan.candidate.id, revision: plan.projectRevision, buildId: plan.buildId, expectedActive: null };
  const child = await promisify(execFile)(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./release-worker.ts", import.meta.url)), root, JSON.stringify(request), JSON.stringify(toolchain)]);
  expect(JSON.parse(child.stdout)).toMatchObject({ ok: false, error: { message: expect.stringContaining("toolchain changed") } });
  await writeFile(join(root, "zudo-composer.config.ts"), "export default {pack:'release-policy/pack'};\n");
  expect(await resolveLocalReleaseToolchain({ ...options, toolchain: plan.toolchain })).not.toHaveProperty("contentValidation");
  const removed = await promisify(execFile)(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./release-worker.ts", import.meta.url)), root, JSON.stringify(request), JSON.stringify(toolchain)]);
  expect(JSON.parse(removed.stdout)).toMatchObject({ ok: false, error: { message: expect.stringContaining("toolchain changed") } });
  const store = createLocalSiteProjectStore(options);
  expect(await store.list()).toMatchObject({ status: "ok", value: { active: null } });
  expect(await store.get({ projectId: plan.candidate.id, revision: plan.projectRevision })).toMatchObject({ status: "ok" });
});

it("keeps working and immutable published Content readable after policy changes without enabling old visitor rendering", async () => {
  const { root, options, service } = await fixture();
  const source = project({ entries: [{ ...entry("selected", "Allowed"), lifecycle: "draft" }] });
  const plan = await review(service, source, { selection });
  await call(service, "apply", { plan });
  await call(service, "build", { projectId: plan.candidate.id, buildId: plan.buildId });
  await call(service, "activate", { projectId: plan.candidate.id, revision: plan.projectRevision, buildId: plan.buildId, expectedActive: null });
  const store = await createFilesystemContentStore({ contentRoot: join(root, "content") });
  await store.seed(source.providers.content[0]!);
  await writeFile(join(root, "policy.mjs"), "export const validateContentField = () => [{code:'new-policy',message:'Correct historical data before publishing'}];\n");
  const policyStore = await createFilesystemContentStore({ contentRoot: store.root, validationPolicy: { validateContentField: () => { throw Error("Reads must not validate"); } } });
  for (const perspective of ["working", "published"] as const) {
    const response = await runContentEditorial(policyStore, () => readActivatedContentRelease(options), "editorial-read", { entry: selection[0]!.ref, perspective });
    expect(response).toMatchObject({ ok: true });
  }
  await expect(readActivatedSiteRelease(options)).rejects.toThrow("toolchain does not match");
});
