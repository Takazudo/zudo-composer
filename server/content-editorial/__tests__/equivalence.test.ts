// Native project-file Content and local SQLite Hosted Content answer the same
// editorial scenario through the shared boundary. Each backend publishes
// through its own real path: a SiteProject release activation for native
// Content, and a hosted snapshot submission and integration for SQLite.
import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONTENT_PROVIDERS, type ContentModelRecord, type ContentEntryRecord } from "../../../src/content";
import { createNativeContentEditorial } from "../../../src/content/editorial";
import { runEditorialScenario, type EditorialScenarioHarness } from "../../../src/content/editorial/scenario";
import { createFilesystemContentStore, type FilesystemContentStore } from "../../../src/content/storage/filesystem";
import { createHostedContentService } from "../../../src/hosted-content/service";
import { createHostedContentEditorial } from "../../../src/hosted-content/editorial";
import { canonicalSerialize } from "../../../src/hosted-content/canonical";
import type { HostedDatabase, HostedPolicy, HostedProvider, HostedService, HostedStorage, JsonValue } from "../../../src/hosted-content/types";
import { createSiteProjectApiService } from "../../../src/site-project/api/service";
import type { CompletedRelease } from "../../../src/site-project/api/types";
import { project } from "../../../src/site-project/compiler/__tests__/fixtures";
import { call, fixture, review } from "../../site-project-local/__tests__/release-fixture";

const timestamp = "2026-01-01T00:00:00.000Z";
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function scratch(prefix: string): Promise<string> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  directories.push(directory);
  return directory;
}

function articleModel(fields: string[] = ["title", "slug", "body", "subtitle"]): ContentModelRecord {
  const all = [
    { id: "title", key: "title", label: "Title", required: true, kind: "text" as const },
    { id: "slug", key: "slug", label: "Slug", required: true, kind: "slug" as const },
    { id: "body", key: "body", label: "Body", required: false, kind: "markdown" as const },
    { id: "subtitle", key: "subtitle", label: "Subtitle", required: false, kind: "text" as const },
  ];
  return { id: "articles", createdAt: timestamp, updatedAt: timestamp, document: { schemaVersion: 1, id: "articles", name: "Articles", description: "", kind: "collection", fields: all.filter((field) => fields.includes(field.id)) } };
}
const article = (providerId: string): ContentEntryRecord => ({
  schemaVersion: 1, id: "first-article", modelId: "articles", lifecycle: "draft", generation: 0, createdAt: timestamp, updatedAt: timestamp,
  values: { title: "Title A", slug: "first-article", body: "Body A", subtitle: "Sub A" },
  ...(providerId ? {} : {}),
});
const check = (actual: unknown, expected: unknown, message: string) => expect(actual, message).toEqual(expected);

async function nativeHarness(): Promise<EditorialScenarioHarness & { store(): FilesystemContentStore }> {
  const root = await scratch("native-editorial-");
  const providerId = CONTENT_PROVIDERS.filesystem.id;
  const open = () => createFilesystemContentStore({ contentRoot: join(root, "content") });
  let store = await open();
  await store.seed({ models: [articleModel()], entries: [article(providerId)] });
  const site = await fixture();
  const service = createSiteProjectApiService({ ...site.dependencies, reconcilePublication: async (_active, changes, generation) => { await store.reconcilePublication(changes, generation); return "applied"; } });
  const entry = { providerId, modelId: "articles", recordId: "first-article" };
  const readPublished = async () => {
    const active = await site.store.readActiveRelease();
    if (active.status !== "ok" || !active.value) return null;
    return { release: active.value.release.identity.buildId, fence: await store.activationFence(), entries: active.value.project.providers.content.find((provider) => provider.id === providerId)?.entries ?? [] };
  };
  return {
    entry,
    store: () => store,
    boundary: (provenance) => createNativeContentEditorial({ store, readPublished, provenance }),
    async publish() {
      const snapshot = await store.readAll();
      const plan = await review(service, project({ contentModel: snapshot.models[0], entries: [...snapshot.entries] }), { selection: [{ ref: entry, action: "publish" }] });
      await call(service, "apply", { plan });
      const completed = await call<CompletedRelease>(service, "build", { projectId: plan.candidate.id, buildId: plan.buildId });
      await call(service, "activate", { ...completed.identity, expectedActive: null });
    },
    async restart() { store = await open(); },
    async removeField(fieldId) { await store.removeField("articles", fieldId); },
  };
}

async function hostedHarness(): Promise<EditorialScenarioHarness> {
  const { initializeSqliteDatabase, openSqliteHandle } = await import(String("../../../fixtures/hosted-content-consumer/sqlite-storage.mjs")) as {
    initializeSqliteDatabase(filename: string, seed: HostedDatabase): Promise<void>;
    openSqliteHandle(filename: string): { storage: HostedStorage; close(): void };
  };
  const filename = join(await scratch("hosted-editorial-"), "database.sqlite");
  const providers: HostedProvider[] = [{ providerId: "content", models: [articleModel()], entries: [article("content")] }];
  await initializeSqliteDatabase(filename, {
    state: { draftRevision: "r0", baseline: { gitSha: "0".repeat(40), contentDigest: "seed" }, definition: "article-v1", integrationFence: 0, providers: structuredClone(providers) },
    // Nothing is activated yet, so the seed has an empty baseline.
    baselineProviders: [{ providerId: "content", models: [articleModel()], entries: [] }],
    receipts: [], snapshots: [], publications: [], revisions: [],
  });
  const policy: HostedPolicy = { models: [{ providerId: "content", modelId: "articles", entryIds: ["first-article"], fields: ["title", "body", "subtitle"].map((fieldId) => ({ fieldId, replace: true, clear: fieldId !== "title" })) }], collections: [], assets: [] };
  let handle = openSqliteHandle(filename);
  let definition = "article-v1";
  let ids = 0;
  const service = (source: string): HostedService => createHostedContentService({
    siteId: "editorial-equivalence", definition, policy, storage: handle.storage, source,
    authorize(actor) { if (actor.id !== "editor") throw new Error("Unauthorized"); },
    digest: async (value) => createHash("sha256").update(value).digest("hex"),
    createId: () => `id-${process.pid}-${++ids}`,
    now: () => timestamp,
    project: (current) => ({ articles: current.flatMap((provider) => provider.entries.map((entry) => entry.values)) }) as unknown as JsonValue,
    validateSubmission: () => undefined,
  });
  const actor = { id: "editor" };
  return {
    entry: { providerId: "content", modelId: "articles", recordId: "first-article" },
    boundary: (provenance) => createHostedContentEditorial({ service, provenance }),
    async publish() {
      const host = service("publication");
      const state = await host.readState(actor);
      const expected = { draftRevision: state.draftRevision, baseline: state.baseline, definition: state.definition };
      const snapshot = (await host.execute(actor, { kind: "capture-snapshot", operationKey: "publish-capture", expected })).snapshot!;
      const publication = (await host.execute(actor, { kind: "begin-publication", operationKey: "publish-begin", expected, snapshotId: snapshot.id })).publication!;
      await host.recordStatus({ publicationId: publication.id, snapshotId: snapshot.id, statusVersion: publication.statusVersion + 1, status: "verified", facts: { artifact: publication.id } });
      await host.recordConfirmedIntegration({ publicationId: publication.id, snapshotId: snapshot.id, expectedBaseline: publication.expectedBaseline, gitSha: createHash("sha1").update(snapshot.digest).digest("hex"), contentDigest: snapshot.digest });
    },
    async restart() { handle.close(); handle = openSqliteHandle(filename); },
    async removeField(fieldId) {
      const old = service("definition");
      const state = await old.readState(actor);
      definition = "article-v2";
      const upgraded = service("definition");
      const canonical = (await handle.storage.readHead()).baselineProviders;
      for (const provider of canonical) {
        provider.models = provider.models.map((model) => ({ ...model, document: { ...model.document, fields: model.document.fields.filter((field) => field.id !== fieldId) } }));
        for (const item of provider.entries) delete item.values[fieldId];
      }
      await upgraded.adoptCanonicalBaseline({ expected: { baseline: state.baseline, definition: state.definition }, baseline: { gitSha: "d".repeat(40), contentDigest: canonicalSerialize(canonical).length.toString() }, providers: canonical, draft: "rebase", apply: true });
    },
  };
}

describe("shared Content editorial boundary", () => {
  it("native project-file Content passes the decisive scenario", async () => {
    const steps = await runEditorialScenario(await nativeHarness(), check);
    expect(steps.map((step) => step.step)).toEqual(["publish-a", "save-b", "prepare-c", "apply-c", "restore-b", "stale-apply", "incompatible-restore"]);
  });

  it("local SQLite Hosted Content passes the same scenario", async () => {
    const steps = await runEditorialScenario(await hostedHarness(), check);
    expect(steps.map((step) => step.step)).toEqual(["publish-a", "save-b", "prepare-c", "apply-c", "restore-b", "stale-apply", "incompatible-restore"]);
  });
});
