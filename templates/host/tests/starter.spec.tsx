import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { render } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import type { SiteProject } from "zudo-composer/site-project";
import { compileStaticSite } from "zudo-composer/site-build";
import { name } from "../package.json";
import { componentPack, Welcome } from "../components/pack";

const root = resolve(import.meta.dirname, "..");

describe("starter site", () => {
  it("renders the host's Preact component with accessible heading ownership", () => {
    const html = render(<Welcome heading="A fresh start" description="This is your page." />);
    expect(html).toContain("A fresh start");
    expect(html).toContain("This is your page.");
    const id = html.match(/<h1 id="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`aria-labelledby="${id}"`);
  });

  it("keeps the committed aggregate tied to the host's own component exports", async () => {
    const project = JSON.parse(await readFile(resolve(root, "site-project.json"), "utf8")) as SiteProject;
    expect(project.componentPack.packId).toBe(name);
    expect(componentPack.manifest.components.map(({ source }) => source.module)).toEqual(Array(3).fill(`${name}/components`));
    expect(project.providers.content[0].models).toHaveLength(1);
    expect(project.providers.content[0].entries).toHaveLength(1);
    expect(project.providers.mappings[0].records).toHaveLength(1);
    expect(project.providers.sitemaps[0].records).toHaveLength(1);
  });

  it("compiles the mapped home page with its committed image", async () => {
    const compiled = await compileStaticSite({ projectPath: resolve(root, "site-project.json"), pack: componentPack, assetsStoreRoot: resolve(root, "cms/assets") });
    expect(compiled.build.routes.map(({ pathname }) => pathname)).toEqual(["/"]);
    expect(JSON.stringify(compiled.build.routes[0].composition.document)).toContain("Welcome to your site");
    expect(compiled.assetFiles).toHaveLength(1);
    const asset = compiled.assetFiles[0];
    expect(Buffer.from(asset.source)).toEqual(await readFile(resolve(root, "public", asset.fileName)));
  });
});
