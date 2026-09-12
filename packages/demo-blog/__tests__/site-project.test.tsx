import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { SiteProject } from "zudo-composer/site-project";
import { componentPack } from "../components/pack";

const packageRoot = resolve(import.meta.dirname, "..");

describe("demo-blog", () => {
  it("declares the home route against its own pack", async () => {
    const project = JSON.parse(await readFile(resolve(packageRoot, "site-project.json"), "utf8")) as SiteProject;
    expect(project.componentPack).toEqual({ contractVersion: 2, packId: "demo-blog", packVersion: "1.0.0" });
    expect(new Set(componentPack.manifest.components.map((component) => component.source.module))).toEqual(new Set(["demo-blog/components"]));
    expect(project.providers.sitemaps[0]?.records[0]?.document.root[0]?.source).toEqual({ kind: "composition", ref: { providerId: "files", recordId: "home" } });
  });
});
