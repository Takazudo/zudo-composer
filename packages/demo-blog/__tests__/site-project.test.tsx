import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertSiteProjectCurrent, readSiteProjectFile } from "demo-tools";
import { componentPack } from "../components/pack";

const packageRoot = resolve(import.meta.dirname, "..");

describe("demo-blog", () => {
  it("ships the site-project.json its site-project.ts generates", async () => {
    await expect(assertSiteProjectCurrent(packageRoot)).resolves.toBeUndefined();
  });

  it("declares the home route against its own pack", async () => {
    const project = await readSiteProjectFile(packageRoot);
    expect(project.componentPack).toEqual({ contractVersion: 2, packId: "demo-blog", packVersion: "1.0.0" });
    expect(new Set(componentPack.manifest.components.map((component) => component.source.module))).toEqual(new Set(["demo-blog/components"]));
    expect(project.providers.sitemaps[0]?.records[0]?.document.root[0]?.source).toEqual({ kind: "composition", ref: { providerId: "files", recordId: "home" } });
  });
});
