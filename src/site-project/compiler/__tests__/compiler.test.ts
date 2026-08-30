import { describe, expect, it } from "vitest";
import { isSafeRecordId } from "../../../shared";
import { compileSiteProject } from "../../index";
import {
  componentCatalog,
  composition,
  entry,
  globalTemplate,
  linkedComposition,
  mapping,
  mappingSource,
  model,
  page,
  project,
} from "./fixtures";

const compile = (value = project()) => compileSiteProject(value, { componentCatalog });

describe("SiteProject compiler", () => {
  it("compiles a static Composition into a concrete synthetic route target", async () => {
    const result = await compile();
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.build.routes).toHaveLength(1);
    expect(result.build.routes[0]).toMatchObject({
      pathname: "/",
      source: { kind: "composition", ref: { providerId: "indexeddb", recordId: "landing" } },
      composition: { local: { providerId: "indexeddb", recordId: "landing" }, document: { id: "landing" } },
    });
    expect(result.build.routes[0]!.composition.routeRecordId).not.toBe("landing");
    expect(isSafeRecordId(result.build.routes[0]!.composition.routeRecordId)).toBe(true);
    expect(result.build.modules).toEqual([expect.objectContaining({ kind: "standalone", code: expect.stringContaining("Static") })]);
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("selects exactly one Entry for a single Mapping and evaluates it before generation", async () => {
    const result = await compile(project({ root: page("about", "about", mappingSource("single")), contentModel: model("single"), entries: [entry("singleton", "Mapped title")] }));
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.build.routes[0]).toMatchObject({ pathname: "/about", selectedEntry: { providerId: "content-indexeddb", recordId: "singleton" }, composition: { document: { root: [{ props: { title: "Mapped title" } }] } } });
    expect(result.build.modules[0]!.code).toContain("Mapped title");
  });

  it("expands collection Entries with encoded Unicode routes and exact Entry selection", async () => {
    const result = await compile(project({ root: page("articles", "café", mappingSource()), entries: [entry("z", "Zulu", "東京"), entry("a", "Alpha", "crème brûlée")] }));
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.build.routes.map((route) => [route.pathname, route.selectedEntry?.recordId, route.composition.document.root[0]?.props.title])).toEqual([
      ["/caf%C3%A9/%E6%9D%B1%E4%BA%AC", "z", "Zulu"],
      ["/caf%C3%A9/cr%C3%A8me%20br%C3%BBl%C3%A9e", "a", "Alpha"],
    ]);
  });

  it.each([0, 2])("blocks a single Mapping with %i Entries and exposes no build", async (count) => {
    const entries = Array.from({ length: count }, (_, index) => entry(`entry-${index}`));
    const result = await compile(project({ root: page("single", "single", mappingSource("single")), contentModel: model("single"), entries }));
    expect(result).toMatchObject({ status: "blocked", diagnostics: [expect.objectContaining({ code: "single-entry-count" })] });
    expect("build" in result).toBe(false);
  });

  it("blocks wrong Mapping route modes and invalid Entry slugs", async () => {
    const wrongMode = await compile(project({ root: page("articles", "articles", mappingSource("single")), entries: [entry("one")] }));
    expect(wrongMode).toMatchObject({ status: "blocked", diagnostics: [expect.objectContaining({ code: "wrong-route-mode", pathname: "/articles" })] });

    const invalidSlug = await compile(project({ root: page("articles", "articles", mappingSource()), entries: [entry("bad", "Bad", "bad/path")] }));
    expect(invalidSlug).toMatchObject({ status: "blocked", diagnostics: [expect.objectContaining({ code: "entry-slug-invalid", entry: { providerId: "content-indexeddb", recordId: "bad" }, pathname: "/articles" })] });
  });

  it("retains colliding route attempts while blocking the top-level verdict", async () => {
    const root = page("root", undefined, { kind: "composition", ref: { providerId: "indexeddb", recordId: "landing" } }, [
      page("one", "same", { kind: "composition", ref: { providerId: "indexeddb", recordId: "landing" } }),
      page("two", "same", { kind: "composition", ref: { providerId: "indexeddb", recordId: "other" } }),
    ]);
    const result = await compile(project({ root, compositions: [composition("landing"), composition("other")] }));
    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") return;
    expect(result.routes.filter((route) => route.pathname === "/same")).toHaveLength(2);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === "route-collision")).toHaveLength(2);
    expect("build" in result).toBe(false);
  });

  it("blocks unassigned and missing Composition pages without silently omitting failure", async () => {
    const root = page("root", undefined, { kind: "unassigned" }, [page("missing", "missing", { kind: "composition", ref: { providerId: "indexeddb", recordId: "gone" } })]);
    const result = await compile(project({ root }));
    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") return;
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["unassigned-page", "composition-not-found"]));
  });

  it("blocks invalid mapped values with the exact Entry context", async () => {
    const invalid = entry("bad", undefined, "bad");
    delete invalid.values.title;
    const result = await compile(project({ root: page("articles", "articles", mappingSource()), entries: [invalid] }));
    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") return;
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "mapping-required-value-missing", entry: { providerId: "content-indexeddb", recordId: "bad" }, pathname: "/articles/bad" }));
  });

  it("materializes linked-template context but plans JSX from the evaluated local document", async () => {
    const result = await compile(project({
      root: page("linked", "linked", mappingSource("single")),
      compositions: [globalTemplate(), linkedComposition()],
      contentModel: model("single"),
      entries: [entry("one", "Mapped linked")],
      mappings: [mapping("linked")],
    }));
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const route = result.build.routes[0]!;
    expect(route.composition).toMatchObject({
      document: { root: [{ props: { title: "Mapped linked" } }] },
      linkedSource: {
        ref: { providerId: "indexeddb", recordId: "shell" },
        outlet: { id: "main", label: "Main", target: { parentId: "shell-root", slotId: "body" } },
        document: { id: "shell" },
      },
    });
    const publication = route.composition.linkedSource?.document.publication;
    expect(publication?.kind).toBe("global-template");
    if (publication?.kind === "global-template") {
      expect(route.composition.linkedSource?.outlet.target).not.toBe(publication.outlet.target);
      expect(route.composition.linkedSource?.outlet.target).toEqual(publication.outlet.target);
    }
    expect(route.modules.map((module) => module.kind)).toEqual(["global-template", "linked-consumer"]);
    expect(route.modules.find((module) => module.kind === "linked-consumer")?.code).toContain("Mapped linked");
  });

  it("plans every mapped linked variant separately and deduplicates an unchanged dependency", async () => {
    const result = await compile(project({
      root: page("linked", "linked", mappingSource()),
      compositions: [globalTemplate(), linkedComposition()],
      entries: [entry("one", "One"), entry("two", "Two")],
      mappings: [mapping("linked")],
    }));
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.build.routes).toHaveLength(2);
    expect(result.build.routes.map((route) => route.modules.find((module) => module.kind === "linked-consumer")?.code)).toEqual([
      expect.stringContaining("One"),
      expect.stringContaining("Two"),
    ]);
    expect(result.build.routes.every((route) => route.modules.filter((module) => module.recordId === "shell").length === 1)).toBe(true);
    expect(result.build.modules.filter((module) => module.recordId === "shell")).toHaveLength(1);
    expect(result.build.modules.filter((module) => module.kind === "linked-consumer")).toHaveLength(2);
  });

  it("reports missing outlets and binding cycles before nested-template failures", async () => {
    const missingSource = await compile(project({ root: page("linked", undefined, { kind: "composition", ref: { providerId: "indexeddb", recordId: "linked" } }), compositions: [linkedComposition("linked", "gone")] }));
    expect(missingSource).toMatchObject({ status: "blocked", diagnostics: [expect.objectContaining({ code: "template-source-not-found", pathname: "/" })] });

    const missingOutlet = await compile(project({ root: page("linked", undefined, { kind: "composition", ref: { providerId: "indexeddb", recordId: "linked" } }), compositions: [globalTemplate(), linkedComposition("linked", "shell", "gone")] }));
    expect(missingOutlet).toMatchObject({ status: "blocked", diagnostics: [expect.objectContaining({ code: "template-missing-outlet" })] });

    const a = linkedComposition("a", "b");
    const b = linkedComposition("b", "a");
    const cycle = await compile(project({ root: page("cycle", undefined, { kind: "composition", ref: { providerId: "indexeddb", recordId: "a" } }), compositions: [a, b] }));
    expect(cycle.status).toBe("blocked");
    if (cycle.status !== "blocked") return;
    expect(cycle.diagnostics.map((item) => item.code)).toContain("template-binding-cycle");
    expect(cycle.diagnostics.map((item) => item.code)).not.toContain("template-nested-template");
  });

  it("emits byte-identical manifests for semantically permuted provider records", async () => {
    const value = project({ root: page("articles", "articles", mappingSource()), entries: [entry("two", "Two"), entry("one", "One")] });
    const permuted = structuredClone(value);
    permuted.providers.compositions[0]!.records.reverse();
    permuted.providers.content[0]!.models.reverse();
    permuted.providers.content[0]!.entries.reverse();
    permuted.providers.mappings[0]!.records.reverse();
    const [left, right] = await Promise.all([compile(value), compile(permuted)]);
    expect(left.status).toBe("ready");
    expect(JSON.stringify(right)).toBe(JSON.stringify(left));
  });

  it("detaches one immutable project snapshot before route expansion", async () => {
    const value = project({ root: page("articles", "articles", mappingSource()), entries: [entry("one", "Original")] });
    const pending = compile(value);
    value.providers.content[0]!.entries[0]!.values.title = "Mutated";
    value.providers.mappings[0]!.records[0]!.document.bindings.length = 0;
    const result = await pending;
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.build.routes[0]!.composition.document.root[0]!.props.title).toBe("Original");
  });
});
