// The Node static-build façade and the portable projection must agree on the
// documents a route renders. The façade reads a committed site-project.json
// and captures the asset lock; the portable entry receives the same project
// value and lock directly.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TrustedComponentPack } from "@zudo-composer/component-contract";
import { componentCatalog, composition, entry, globalTemplate, linkedComposition, mapping, mappingSource, page, project } from "../../src/site-project/compiler/__tests__/fixtures";
import { canonicalStringifyJson, serializeSiteProject } from "../../src/site-project/model/canonical";
import { compileSiteProjectPlan, stripSiteBuildModules } from "../../src/hosted-content/compile";
import { compileStaticSite } from "../site-build/compile";

const pack = { manifest: componentCatalog.pack, runtime: { resolve: () => undefined } } as unknown as TrustedComponentPack;
let root = "";
function collectionMapping() {
  const record = mapping();
  record.document.mode = { kind: "collection", query: { publication: "published-only", conditions: [], sort: [], pins: [], limit: 100 } };
  return record;
}

beforeAll(async () => { root = await mkdtemp(join(tmpdir(), "zudo-composer-portable-parity-")); });
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe("portable projection parity", () => {
  it("compileStaticSite and compileSiteProjectPlan produce identical route documents for the same project", async () => {
    const value = project({
      root: page("home", undefined, { kind: "composition", ref: { providerId: "files", recordId: "linked" } }, [page("articles", "articles", mappingSource("entry-field", "title"))]),
      compositions: [globalTemplate(), linkedComposition(), composition("landing")],
      entries: [entry("a", "Alpha"), entry("b", "Beta")],
      mappings: [collectionMapping()],
    });
    const projectPath = join(root, "site-project.json");
    await writeFile(projectPath, canonicalStringifyJson(value as never));
    const node = await compileStaticSite({ projectPath, pack, assetsStoreRoot: join(root, "assets") });
    const portable = await compileSiteProjectPlan(JSON.parse(canonicalStringifyJson(value as never)), componentCatalog.pack, { policy: "release" });
    expect(portable.status).toBe("ready");
    if (portable.status !== "ready") return;
    expect(portable.plan).toEqual(stripSiteBuildModules(node.build));
    expect(portable.plan.routes.map(({ pathname, composition: { document, linkedSource } }) => ({ pathname, document, linkedSource }))).toEqual(
      node.build.routes.map(({ pathname, composition: { document, linkedSource } }) => ({ pathname, document, linkedSource })),
    );
    expect(portable.plan.navigation).toEqual(node.build.navigation);
    expect(node.build.modules.length).toBeGreaterThan(0);
    expect(serializeSiteProject(portable.project)).toBe(serializeSiteProject(node.project));
  });
});
