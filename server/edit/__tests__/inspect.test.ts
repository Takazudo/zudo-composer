import { describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { componentCatalog, composition, page, project } from "../../../src/site-project/compiler/__tests__/fixtures";
import { composer } from "../../config/config";
import { captureHost, resolvePage, type HostCapture } from "../inspect";

function capture(): HostCapture {
  const record = composition("landing");
  const site = project({ compositions: [record], root: page("home", undefined, { kind: "composition", ref: { providerId: "files", recordId: "landing" } }) });
  return {
    config: composer({ pack: "host/components", nativeEditing: { source: "workspace", paragraph: { componentId: "leaf", textProp: "title" } } }),
    workspaceId: "chosen", workspace: { metadata: site }, sourceAuthored: false,
    manifest: componentCatalog,
    records: { compositions: [record], sitemaps: site.providers.sitemaps.flatMap((provider) => provider.records), mappings: [] },
  } as unknown as HostCapture;
}

describe("canonical native inspection", () => {
  it("refuses an uninitialized host without creating CMS state", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-inspect-"));
    try {
      await expect(captureHost({ config: composer({ workspaceRoot: root, pack: "host/components" }), pack: {} as never, packIdentity: {} as never })).rejects.toThrow(/existing canonical storage/);
      expect(await readdir(root)).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("resolves exact page identity and explicit native targets", () => {
    const result = resolvePage(capture(), { workspaceId: "chosen", page: "home" });
    expect(result.identity.recordId).toBe("landing");
    expect(result.targets).toMatchObject([{ kind: "paragraph", ordinal: 1 }]);
    expect(result.writeBlockers).toEqual([]);
  });
  it("rejects title guessing and another selected workspace", () => {
    expect(resolvePage(capture(), { workspaceId: "chosen", page: "/" }).pageId).toBe("home");
    expect(() => resolvePage(capture(), { workspaceId: "other", page: "home" })).toThrow(/selected workspace/);
    expect(() => resolvePage(capture(), { workspaceId: "chosen", page: "Home" })).toThrow(/exactly one/);
  });
  it("reports source authority and shared consumers before any write", () => {
    const value = capture(); value.sourceAuthored = true;
    const sitemap = value.records.sitemaps[0]!;
    sitemap.document.root[0]!.children.push({ ...sitemap.document.root[0]!, id: "other", children: [] });
    const result = resolvePage(value, { workspaceId: "chosen", page: "home" });
    expect(result.consumers).toHaveLength(2);
    expect(result.writeBlockers.join(" ")).toMatch(/Source-authored.*shared/);
  });
  it("refuses a direct composition under a collection mapping even by node ID", () => {
    const value = capture();
    const sitemap = value.records.sitemaps[0]!;
    const child = sitemap.document.root[0]!;
    sitemap.document.root = [{ id: "collection", title: "Collection with two entry routes", source: { kind: "mapping", ref: { providerId: "mapping-filesystem", recordId: "two-entry-collection" }, route: { kind: "entry-field", fieldId: "slug" } }, children: [child] }];
    expect(() => resolvePage(value, { workspaceId: "chosen", page: "home" })).toThrow(/Mapping subtree/);
    expect(() => resolvePage(value, { workspaceId: "chosen", page: "/" })).toThrow(/exactly one/);
  });
});
