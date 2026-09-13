// @vitest-environment node

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSiteManifest, SITE_HEADERS, SITE_MANIFEST, siteHeaders, verifySiteStaticArtifact } from "../../server/site-build/artifact.mjs";
import { createDocSiteManifest, DOC_SITE_MANIFEST, verifyDocSiteArtifact } from "./doc-site-artifact.mjs";
import { DEFAULT_TARGET_KEY, HOSTED_DEMO_LIVE_ROUTES, TARGET_KEYS, TARGETS, resolveTarget } from "./targets.mjs";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe("hosted-demo deploy targets", () => {
  it("names every target's Worker, config file and custom domain", () => {
    expect(DEFAULT_TARGET_KEY).toBe("zudo-composer");
    expect(TARGET_KEYS).toEqual(["zudo-composer", "webshop", "landing", "blog", "doc"]);
    expect(TARGETS["zudo-composer"]).toMatchObject({ workerName: "zudo-composer", configPath: "wrangler.jsonc", domain: "zudo-composer.zudolab.dev", kind: "hosted-demo" });
    expect(TARGETS.webshop).toMatchObject({ workerName: "zudo-composer-demo-shop", configPath: "wrangler.demo-shop.jsonc", domain: "zc-demo-shop.zudolab.dev", kind: "site-static" });
    expect(TARGETS.landing).toMatchObject({ workerName: "zudo-composer-demo-landing", configPath: "wrangler.demo-landing.jsonc", domain: "zc-demo-landing.zudolab.dev", kind: "site-static" });
    expect(TARGETS.blog).toMatchObject({ workerName: "zudo-composer-demo-blog", configPath: "wrangler.demo-blog.jsonc", domain: "zc-demo-blog.zudolab.dev", kind: "site-static" });
    expect(TARGETS.doc).toMatchObject({ workerName: "zudo-composer-doc", configPath: "wrangler.doc.jsonc", domain: "zc-doc.zudolab.dev", kind: "doc-site" });
    for (const key of TARGET_KEYS) expect(TARGETS[key].artifactDirectory.endsWith("dist-site") || TARGETS[key].artifactDirectory.endsWith("dist-hosted-demo") || TARGETS[key].artifactDirectory.endsWith("doc/dist")).toBe(true);
  });

  it("rejects an unknown target", () => {
    expect(() => resolveTarget("nope")).toThrow(/Unknown hosted-demo deploy target: nope/);
    expect(resolveTarget("webshop")).toBe(TARGETS.webshop);
  });

  it("gives the hosted composer demo its fixed authoring/sample route list", () => {
    expect(TARGETS["zudo-composer"].liveRoutes({})).toBe(HOSTED_DEMO_LIVE_ROUTES);
    expect(HOSTED_DEMO_LIVE_ROUTES).toContain("/composer");
    expect(HOSTED_DEMO_LIVE_ROUTES).toContain("/review");
  });

  it("reads a static demo site's live routes from its own manifest", () => {
    expect(TARGETS.webshop.liveRoutes({ routes: ["/", "/about"] })).toEqual(["/", "/about"]);
  });

  it("maps doc-site routes and assets and verifies a multi-page tree", async () => {
    const directory = await mkdtemp(join(tmpdir(), "doc-site-target-"));
    directories.push(directory);
    const files: Record<string, string> = {
      "index.html": "<!doctype html><h1>Docs</h1>",
      "docs/a/index.html": "<!doctype html><h1>A</h1>",
      "x.html": "<!doctype html><h1>X</h1>",
      "404.html": "<!doctype html><h1>Not found</h1>",
      "assets/site.css": "body { color: black; }",
      "assets/favicon.ico": "ico bytes",
      "sitemap.xml": "<urlset />",
    };
    for (const [path, content] of Object.entries(files)) {
      await mkdir(join(directory, path, ".."), { recursive: true });
      await writeFile(join(directory, path), content);
    }
    const sourceRevision = "a".repeat(40);
    const manifest = await createDocSiteManifest({ directory, sourceRevision });
    await writeFile(join(directory, DOC_SITE_MANIFEST), JSON.stringify(manifest));
    const target = TARGETS.doc;

    expect(target.liveRoutes(manifest)).toEqual(["/", "/docs/a/", "/x"]);
    expect(target.routeFile?.("/", manifest)).toBe("index.html");
    expect(target.routeFile?.("/docs/a/", manifest)).toBe("docs/a/index.html");
    expect(target.routeFile?.("/x", manifest)).toBe("x.html");
    expect(target.assetUrl?.("index.html")).toBeNull();
    expect(target.assetUrl?.("docs/a/index.html")).toBeNull();
    expect(target.assetUrl?.("404.html")).toBe("/404");
    expect(target.assetUrl?.("x.html")).toBe("/x");
    expect(target.assetUrl?.("assets/site.css")).toBe("/assets/site.css");
    expect(target.verifyArtifact).toBe(verifyDocSiteArtifact);

    const artifact = await target.verifyArtifact({ directory, expectedSourceRevision: sourceRevision });
    expect(artifact.manifest.sourceRevision).toBe(sourceRevision);
    expect(artifact.files.find((file) => file.path === "assets/favicon.ico")).toMatchObject({
      mime: "image/vnd.microsoft.icon",
      acceptedMimes: ["image/vnd.microsoft.icon", "image/x-icon"],
    });
    expect(artifact.files.find((file) => file.path === "sitemap.xml")).toMatchObject({
      mime: "application/xml",
      acceptedMimes: ["application/xml", "text/xml"],
    });
    await writeFile(join(directory, DOC_SITE_MANIFEST), JSON.stringify({ ...manifest, sourceRevision: undefined }));
    await expect(target.verifyArtifact({ directory })).resolves.toMatchObject({ manifest: { kind: "doc-site" } });
  });

  it("adapts a static site artifact to the shared { root, manifest, files } shape, dropping _headers", async () => {
    const directory = await mkdtemp(join(tmpdir(), "site-static-target-"));
    directories.push(directory);
    const pinBytes = Buffer.from("pinned");
    const pinPath = `uploaded-assets/sha256-${createHash("sha256").update(pinBytes).digest("hex")}.png`;
    const files: Record<string, string | Buffer> = {
      "index.html": "<!doctype html><div id=\"app\"></div>",
      "assets/index-abc.js": "console.log('site');",
      [pinPath]: pinBytes,
      [SITE_HEADERS]: siteHeaders([{ path: pinPath, byteLength: pinBytes.byteLength }]),
    };
    for (const [path, content] of Object.entries(files)) {
      await mkdir(join(directory, path, ".."), { recursive: true });
      await writeFile(join(directory, path), content);
    }
    const sourceRevision = "a".repeat(40);
    const manifest = await createSiteManifest({ directory, projectId: "demo-webshop", sourceRevision, projectSourceRevision: "b".repeat(64), routes: ["/", "/about"] });
    await writeFile(join(directory, SITE_MANIFEST), JSON.stringify(manifest));

    const artifact = await TARGETS.webshop.verifyArtifact({ directory, expectedSourceRevision: sourceRevision });
    expect(artifact.files.map((file) => file.path)).toEqual(["assets/index-abc.js", "index.html", pinPath].sort());
    expect(artifact.files.find((file) => file.path === "index.html")).toMatchObject({ mime: "text/html" });
    expect(artifact.files.find((file) => file.path === pinPath)).toMatchObject({ mime: "image/png" });
    expect(artifact.manifest.projectId).toBe("demo-webshop");
    expect(artifact.root.endsWith(directory.split("/").pop()!)).toBe(true);
    await expect(TARGETS.webshop.verifyArtifact({ directory, expectedSourceRevision: "c".repeat(40) })).rejects.toThrow(/sourceRevision does not match/);
    // Local artifacts can omit a revision or use another revision system;
    // the existing production target contract still requires a full Git SHA.
    for (const sourceRevision of [undefined, "release-local"]) {
      await writeFile(join(directory, SITE_MANIFEST), JSON.stringify({ ...manifest, sourceRevision }));
      await expect(verifySiteStaticArtifact({ directory })).resolves.toMatchObject({ projectId: "demo-webshop" });
      await expect(TARGETS.webshop.verifyArtifact({ directory })).rejects.toThrow(/Deployed site artifact requires/);
      await expect(TARGETS.webshop.verifyArtifact({ directory, expectedSourceRevision: "a".repeat(40) })).rejects.toThrow(/sourceRevision does not match/);
    }
  });
});
