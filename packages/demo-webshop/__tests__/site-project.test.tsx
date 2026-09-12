import { resolve } from "node:path";
import { render } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { assertSiteProjectCurrent, readSiteProjectFile } from "demo-tools";
import { Hello, componentPack } from "../components/pack";

const packageRoot = resolve(import.meta.dirname, "..");

describe("demo-webshop", () => {
  it("ships the site-project.json its site-project.ts generates", async () => {
    await expect(assertSiteProjectCurrent(packageRoot)).resolves.toBeUndefined();
  });

  it("declares the home route against its own pack", async () => {
    const project = await readSiteProjectFile(packageRoot);
    expect(project.componentPack).toEqual({ contractVersion: 2, packId: "demo-webshop", packVersion: "1.0.0" });
    expect(componentPack.manifest.components.map((component) => component.source.module)).toEqual(["demo-webshop/components"]);
    expect(project.providers.sitemaps[0]?.records[0]?.document.root[0]?.source).toEqual({ kind: "composition", ref: { providerId: "files", recordId: "home" } });
  });

  it("renders the placeholder component from the shop- token namespace", () => {
    expect(render(<Hello text="Hi" />)).toBe('<p class="text-shop-accent">Hi</p>');
  });
});
