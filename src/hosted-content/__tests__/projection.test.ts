import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defineComponent, defineComponentPack } from "@zudo-composer/component-contract";
import { compileStaticSite } from "../../../server/site-build/compile";
import { defineSite, node } from "../../site-project/authoring";
import type { SiteProject } from "../../site-project/model/types";
import { createHostedSiteProjector, projectHostedSite } from "../projection";
import { createHostedContentService } from "../service";
import { createMemoryHostedStorage } from "../testing";
import type { HostedProvider, JsonValue } from "../types";

// Manifest-only fixture components; the projection never renders them.
const render = <P,>() => (props: P): null => { void props; return null; };
const Layout = render<{ children?: unknown }>(), Offer = render<{ title?: string; questions?: unknown }>(), Question = render<{ question?: string }>();
const source = <const T extends string>(exportName: T) => ({ module: "independent-host/components", exportKind: "named", exportName }) as const;
const pack = defineComponentPack({ packId: "host-offer", packVersion: "1.0.0", components: [
  defineComponent<{ children?: unknown }>()(Layout, { id: "host:Layout", schemaVersion: 1, title: "Layout", category: "Host", description: "Fixed layout", source: source("Layout"),
    slots: [{ id: "main", prop: "children", label: "Main", cardinality: "many" }] }),
  defineComponent<{ title?: string; questions?: unknown }>()(Offer, { id: "host:Offer", schemaVersion: 1, title: "Offer", category: "Host", description: "Offer", source: source("Offer"), defaults: { title: "Fallback" },
    fields: [{ prop: "title", label: "Title", schema: { type: "string" }, editor: { kind: "text" } }],
    slots: [{ id: "questions", prop: "questions", label: "Questions", cardinality: "many" }] }),
  defineComponent<{ question?: string }>()(Question, { id: "host:Question", schemaVersion: 1, title: "Question", category: "Host", description: "FAQ item", source: source("Question"), defaults: { question: "" },
    fields: [{ prop: "question", label: "Question", schema: { type: "string" }, editor: { kind: "text" } }] }),
] });

function fixedSite(): SiteProject {
  const site = defineSite({ id: "hosted-projection", name: "Hosted projection", componentPack: pack });
  const template = site.template({ id: "approved-layout", name: "Approved layout", root: [node("host:Layout", {}, { main: [] }, "frame")],
    outlet: { id: "main", target: { parentId: "frame", slotId: "main" } } });
  const page = site.page({ id: "home-page", name: "Home", template, root: [node("host:Offer", { title: "Static" }, { questions: [] }, "offer")] });
  const item = site.page({ id: "faq-item", name: "FAQ item", root: [node("host:Question", { question: "" }, {}, "question")] });
  const pageModel = site.model({ id: "page", name: "Page", kind: "single", fields: [{ key: "title", kind: "text" }] });
  const faqModel = site.model({ id: "faq", name: "FAQ", kind: "collection", fields: [{ key: "question", kind: "text" }, { key: "order", kind: "number" }] });
  site.entry(pageModel, { id: "home", lifecycle: "published", values: { title: "日本語の講座" } });
  site.entry(faqModel, { id: "faq-one", lifecycle: "published", values: { question: "初回の質問", order: 1 } });
  site.entry(faqModel, { id: "faq-draft", lifecycle: "draft", values: { question: "未公開の質問", order: 2 } });
  const home = site.mapping({ name: "Home content", model: pageModel, composition: page, bindings: [{ field: "title", nodeId: "offer", prop: "title" }] });
  const faqs = site.mapping({ name: "FAQ items", model: faqModel, composition: item, mode: { kind: "collection", sort: [{ field: "order", direction: "asc" }] },
    bindings: [{ field: "question", nodeId: "question", prop: "question" }] });
  site.attach(faqs, { nodeId: "offer", slotId: "questions", composition: page });
  site.sitemap({ name: "Routes", root: { id: "home", title: "Home", slug: "", mapping: home } });
  return site.toSiteProject();
}
const fieldId = (provider: { models: SiteProject["providers"]["content"][number]["models"] }, modelId: string, key: string) =>
  provider.models.find((model) => model.id === modelId)!.document.fields.find((field) => field.key === key)!.id;
/** A hosted delivery candidate: every permitted Entry, including a new one, is marked published. */
function candidate(project: SiteProject): HostedProvider[] {
  return project.providers.content.map((provider) => {
    const entries = structuredClone(provider.entries);
    const home = entries.find((entry) => entry.id === "home"), first = entries.find((entry) => entry.id === "faq-one");
    if (home) home.values[fieldId(provider, "page", "title")] = "新しい講座";
    if (first) entries.push({ ...structuredClone(first), id: "faq-new", values: { [fieldId(provider, "faq", "question")]: "新しい質問", [fieldId(provider, "faq", "order")]: 0 } });
    return { providerId: provider.id, models: structuredClone(provider.models), entries };
  });
}

describe("Worker-safe hosted site projection", () => {
  it("projects the template, outlet, mapping and ordered collection exactly as compileStaticSite builds them", async () => {
    const project = fixedSite(), providers = candidate(project);
    const projection = await projectHostedSite({ project, componentPack: pack.manifest }, providers);
    expect(projection.status).toBe("ready");
    if (projection.status !== "ready") return;
    const route = projection.routes[0]!;
    expect(route).not.toHaveProperty("modules");
    expect(route.pathname).toBe("/");
    expect(route.composition.linkedSource).toMatchObject({ ref: { recordId: "approved-layout" }, outlet: { id: "main", target: { parentId: "frame", slotId: "main" } } });
    const offer = route.composition.document.root[0]!;
    expect(offer.props.title).toBe("新しい講座");
    expect(offer.slots.questions!.map((item) => item.props.question)).toEqual(["新しい質問", "初回の質問"]);

    const directory = await mkdtemp(join(tmpdir(), "hosted-projection-"));
    try {
      const built = structuredClone(project);
      for (const provider of built.providers.content) provider.entries = providers.find((item) => item.providerId === provider.id)!.entries;
      await writeFile(join(directory, "site-project.json"), JSON.stringify(built));
      const compilation = await compileStaticSite({ projectPath: join(directory, "site-project.json"), pack, assetsStoreRoot: join(directory, "no-assets") });
      expect(JSON.stringify(projection.routes)).toBe(JSON.stringify(compilation.build.routes.map((item) => { const { modules, ...neutral } = item; void modules; return neutral; })));
      expect(projection.navigation).toEqual(compilation.build.navigation);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("reports definition drift and uncompilable drafts as blocked render data", async () => {
    const project = fixedSite(), providers = candidate(project);
    const drifted = structuredClone(providers); drifted[0]!.models[0]!.document.name = "Changed";
    expect(await projectHostedSite({ project, componentPack: pack.manifest }, drifted)).toMatchObject({ status: "blocked", diagnostics: [{ code: "definition-mismatch" }] });
    expect(await projectHostedSite({ project, componentPack: pack.manifest }, [{ ...providers[0]!, providerId: "elsewhere" }])).toMatchObject({ status: "blocked", diagnostics: [{ code: "provider-not-planned" }] });
    const unpublished = structuredClone(providers); for (const entry of unpublished[0]!.entries) if (entry.id === "home") entry.lifecycle = "draft";
    const blocked = await projectHostedSite({ project, componentPack: pack.manifest }, unpublished);
    expect(blocked.status).toBe("blocked");
  });

  it("serves as the trusted service projection so the snapshot carries the neutral route data", async () => {
    const project = fixedSite(), [provider] = candidate(project);
    const providers = [{ ...provider!, entries: provider!.entries.filter((entry) => entry.id !== "faq-new") }];
    const memory = createMemoryHostedStorage({ state: { draftRevision: "r0", baseline: { gitSha: "g0", contentDigest: "c0" }, definition: "d0", integrationFence: 0, providers }, baselineProviders: structuredClone(providers), receipts: [], snapshots: [], publications: [], revisions: [] });
    let id = 0;
    const service = createHostedContentService({ siteId: "projection", definition: "d0", storage: memory.storage, authorize: () => undefined,
      policy: { models: [{ providerId: provider!.providerId, modelId: "page", entryIds: ["home"], fields: [{ fieldId: fieldId(providers[0]!, "page", "title"), replace: true }] }], collections: [], assets: [] },
      digest: async (value) => createHash("sha256").update(value).digest("hex"), createId: () => `id-${++id}`, now: () => "2026-10-13T00:00:00.000Z",
      project: createHostedSiteProjector({ project, componentPack: pack.manifest }), validateSubmission: () => undefined });
    const state = await service.readState({ id: "editor" });
    const { snapshot } = await service.execute({ id: "editor" }, { kind: "capture-snapshot", operationKey: "capture", expected: { draftRevision: state.draftRevision, baseline: state.baseline, definition: state.definition } });
    const data = snapshot!.renderData as { status: string; routes: { composition: { document: { root: { props: Record<string, JsonValue> }[] } } }[] };
    expect(data.status).toBe("ready");
    expect(data.routes[0]!.composition.document.root[0]!.props.title).toBe("新しい講座");
  });
});
