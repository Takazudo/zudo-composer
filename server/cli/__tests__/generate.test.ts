import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentPackManifest } from "@zudo-composer/component-contract";
import { defineSite } from "../../../src/site-project/authoring";
import { canonicalStringifyJson } from "../../../src/site-project/model/canonical";
import { generateSiteProject, loadSite, renderSiteProject, SITE_OUTPUT_FILE, SITE_SOURCE_FILE, SiteProjectGenerationError } from "../generate";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function manifest(packId = "generate-test"): ComponentPackManifest {
  return { kind: "zudo-composer/component-pack", contractVersion: 2, packId, packVersion: "1.0.0", components: [] };
}

function siteFor(pack: ComponentPackManifest) {
  const site = defineSite({ id: "generate-test", name: "Generate test", componentPack: { manifest: pack } });
  const home = site.page({ name: "Home", root: [] });
  site.sitemap({ name: "Test sitemap", root: { title: "Home", page: home } });
  return site;
}

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), "generate-cli-"));
  roots.push(root);
  const pack = manifest();
  const site = siteFor(pack);
  const evaluate = vi.fn(async (path: string) => {
    expect(path).toBe(join(root, SITE_SOURCE_FILE));
    return { default: site };
  });
  return { root, pack, site, evaluate };
}

describe("SiteProject generator", () => {
  it("loads the host source, validates with the resolved host pack, writes canonical output, and is idempotent", async () => {
    const current = await makeFixture();
    const result = await generateSiteProject({ packageRoot: current.root, componentPack: current.pack, evaluate: current.evaluate });
    expect(result).toEqual({ outputPath: join(current.root, SITE_OUTPUT_FILE), changed: true });
    const text = await readFile(result.outputPath, "utf8");
    expect(text).toBe(canonicalStringifyJson(JSON.parse(text)));
    const before = await stat(result.outputPath, { bigint: true });

    const repeated = await generateSiteProject({ packageRoot: current.root, componentPack: current.pack, evaluate: current.evaluate });
    expect(repeated).toEqual({ outputPath: result.outputPath, changed: false });
    expect((await stat(result.outputPath, { bigint: true })).mtimeNs).toBe(before.mtimeNs);
  });

  it("checks current output without writing and names stale and missing files precisely", async () => {
    const current = await makeFixture();
    await expect(generateSiteProject({ packageRoot: current.root, componentPack: current.pack, evaluate: current.evaluate, check: true })).rejects.toThrow(
      `${SITE_OUTPUT_FILE} is missing in ${current.root}: generate it from ${SITE_SOURCE_FILE} with \`zudo-composer generate\`.`,
    );

    await generateSiteProject({ packageRoot: current.root, componentPack: current.pack, evaluate: current.evaluate });
    const outputPath = join(current.root, SITE_OUTPUT_FILE);
    await writeFile(outputPath, "stale\n");
    await expect(generateSiteProject({ packageRoot: current.root, componentPack: current.pack, evaluate: current.evaluate, check: true })).rejects.toThrow(
      `${SITE_OUTPUT_FILE} in ${current.root} is stale: generated content from ${SITE_SOURCE_FILE} differs. Run \`zudo-composer generate\`.`,
    );
    expect(await readFile(outputPath, "utf8")).toBe("stale\n");
  });

  it("uses the host pack as validation context and rejects an invalid default export", async () => {
    const current = await makeFixture();
    const otherPack = manifest("different-pack");
    await expect(generateSiteProject({ packageRoot: current.root, componentPack: otherPack, evaluate: current.evaluate }))
      .rejects.toMatchObject({ diagnostics: expect.arrayContaining([expect.objectContaining({ code: "component-pack-mismatch" })]) });

    await expect(loadSite(current.root, async () => ({ default: {} }))).rejects.toThrow(
      `${SITE_SOURCE_FILE} must default-export a site built with defineSite().`,
    );
    expect(() => renderSiteProject(current.site, otherPack)).toThrow(SiteProjectGenerationError);
  });
});
