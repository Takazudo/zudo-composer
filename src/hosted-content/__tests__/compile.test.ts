import { describe, expect, it } from "vitest";
import { compileSiteProject } from "../../site-project/compiler";
import { componentCatalog, composition, entry, globalTemplate, linkedComposition, mapping, mappingSource, page, project } from "../../site-project/compiler/__tests__/fixtures";
import { compileSiteProjectPlan, stripSiteBuildModules } from "../compile";

const manifest = componentCatalog.pack;
function collectionMapping() {
  const record = mapping();
  record.document.mode = { kind: "collection", query: { publication: "published-only", conditions: [], sort: [], pins: [], limit: 100 } };
  return record;
}

describe("compileSiteProjectPlan", () => {
  it("projects the same route documents, linked sources and navigation as the full compiler, without module source", async () => {
    const value = project({
      root: page("home", undefined, { kind: "composition", ref: { providerId: "files", recordId: "linked" } }, [page("articles", "articles", mappingSource("entry-field", "title"))]),
      compositions: [globalTemplate(), linkedComposition(), composition("landing")],
      entries: [entry("a", "Alpha"), entry("b", "Beta")],
      mappings: [collectionMapping()],
    });
    const full = await compileSiteProject(value, { componentCatalog });
    const portable = await compileSiteProjectPlan(structuredClone(value), manifest);
    expect(full.status).toBe("ready");
    expect(portable.status).toBe("ready");
    if (full.status !== "ready" || portable.status !== "ready") return;
    expect(full.build.modules.length).toBeGreaterThan(0);
    expect(portable.plan).toEqual(stripSiteBuildModules(full.build));
    expect(Object.keys(portable.plan)).not.toContain("modules");
    expect(portable.plan.routes.every((route) => !("modules" in route))).toBe(true);
    expect(portable.plan.routes.map(({ pathname }) => pathname)).toEqual(["/", "/articles/a", "/articles/b"]);
    expect(portable.plan.routes[0]!.composition.linkedSource?.ref).toEqual({ providerId: "files", recordId: "shell" });
    expect(portable.plan.routes[1]!.composition.document.root[0]!.props.title).toBe("Alpha");
    expect(portable.project).toEqual(value);
  });

  it("validates the untrusted project value against the pack before compiling", async () => {
    const invalid = await compileSiteProjectPlan({ schemaVersion: 2, id: "x" }, manifest);
    expect(invalid.status).toBe("invalid");
    if (invalid.status !== "invalid") return;
    expect(invalid.diagnostics.length).toBeGreaterThan(0);
    const wrongPack = project();
    wrongPack.componentPack.packVersion = "9.9.9";
    expect((await compileSiteProjectPlan(wrongPack, manifest)).status).toBe("invalid");
  });

  it("applies the publication policy and forwards an asset lock", async () => {
    const draft = entry("chosen", "Chosen");
    draft.lifecycle = "draft";
    const mapped = mapping();
    mapped.document.mode = { kind: "collection", query: { publication: "include-drafts", conditions: [], sort: [], pins: [], limit: 100 } };
    const value = project({ root: page("fixed", "fixed", { kind: "mapping", ref: { providerId: "mapping-filesystem", recordId: mapped.id }, route: { kind: "selected-entry", entry: { providerId: "content-filesystem", modelId: "articles", recordId: draft.id } } }), mappings: [mapped], entries: [draft, entry("other")] });
    expect((await compileSiteProjectPlan(value, manifest)).status).toBe("blocked");
    const preview = await compileSiteProjectPlan(value, manifest, { policy: "authoring-preview" });
    expect(preview.status).toBe("ready");
    const invalidLock = await compileSiteProjectPlan(project(), manifest, { assetLock: { schemaVersion: 1, providerId: "assets", mutationToken: "x", pins: [{ bogus: true }] } as never });
    expect(invalidLock.status).toBe("blocked");
    if (invalidLock.status !== "blocked") return;
    expect(invalidLock.diagnostics[0]!.code).toBe("asset-lock-invalid");
  });
});
