// @vitest-environment node

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSiteManifest, SITE_HEADERS, SITE_MANIFEST, siteHeaders, verifySiteStaticArtifact } from "../../server/site-build/artifact.mjs";
import { createDocSiteManifest, DOC_SITE_MANIFEST, verifyDocSiteArtifact } from "./doc-site-artifact.mjs";
import { TARGET_KEYS, TARGETS, resolveTarget } from "./targets.mjs";

import { demoEditorRoutes } from "../routes.mjs";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe("hosted-demo deploy targets", () => {
  it("names all ten Workers, configs, domains, host directories and artifact directories", () => {
    expect(TARGET_KEYS).toEqual(["doc", "sample", "shop", "landing", "blog", "sample-editor", "shop-editor", "landing-editor", "blog-editor", "sample-sg"]);
    expect(TARGETS.doc).toMatchObject({ workerName: "zudo-composer", configPath: "wrangler.doc.jsonc", domain: "zudo-composer.zudolab.dev", kind: "doc-site" });
    expect(TARGETS["sample-sg"]).toMatchObject({ workerName: "zc-sg-sample", configPath: "wrangler.sample-sg.jsonc", domain: "zc-sg-sample.zudolab.dev", kind: "doc-site", artifactDirectory: resolve(import.meta.dirname, "../..", "styleguide/sample/dist"), manifestFileName: DOC_SITE_MANIFEST, ciArtifactName: expect.any(Function) });
    expect(TARGETS.sample).toMatchObject({ workerName: "zc-demo-sample", configPath: "wrangler.demo-sample.jsonc", domain: "zc-demo-sample.zudolab.dev", kind: "site-static" });
    expect(TARGETS.shop).toMatchObject({ workerName: "zc-demo-shop", configPath: "wrangler.demo-shop.jsonc", domain: "zc-demo-shop.zudolab.dev", kind: "site-static" });
    expect(TARGETS.landing).toMatchObject({ workerName: "zc-demo-landing", configPath: "wrangler.demo-landing.jsonc", domain: "zc-demo-landing.zudolab.dev", kind: "site-static" });
    expect(TARGETS.blog).toMatchObject({ workerName: "zc-demo-blog", configPath: "wrangler.demo-blog.jsonc", domain: "zc-demo-blog.zudolab.dev", kind: "site-static" });
    for (const [key, hostDirectory] of Object.entries({
      sample: "packages/demo-sample",
      shop: "packages/demo-webshop",
      landing: "packages/demo-landing",
      blog: "packages/demo-blog",
      "sample-editor": "packages/demo-sample",
      "shop-editor": "packages/demo-webshop",
      "landing-editor": "packages/demo-landing",
      "blog-editor": "packages/demo-blog",
    })) {
      const target = TARGETS[key];
      expect(target.hostDirectory).toBe(resolve(import.meta.dirname, "../..", hostDirectory));
      const artifactName = key.endsWith("-editor") ? "dist-editor" : "dist-site";
      expect(target.artifactDirectory).toBe(resolve(target.hostDirectory!, artifactName));
    }
    for (const name of ["sample", "shop", "landing", "blog"]) {
      expect(TARGETS[`${name}-editor`]).toMatchObject({
        kind: "demo-editor",
        workerName: `zc-demo-${name}-editor`,
        configPath: `wrangler.demo-${name}-editor.jsonc`,
        domain: `zc-demo-${name}-editor.zudolab.dev`,
        manifestFileName: "demo-editor-manifest.json",
        ciArtifactName: expect.any(Function),
      });
      expect(TARGETS[`${name}-editor`].ciArtifactName("a".repeat(40))).toBe(`demo-editor-${name}-${"a".repeat(40)}`);
    }
    expect(TARGETS.doc.ciArtifactName("a".repeat(40))).toBe(`doc-site-${"a".repeat(40)}`);
    expect(TARGETS["sample-sg"].ciArtifactName("a".repeat(40))).toBe(`sample-sg-site-${"a".repeat(40)}`);
    for (const name of ["sample", "shop", "landing", "blog"]) expect(TARGETS[name].ciArtifactName("a".repeat(40))).toBe(`demo-site-${name}-${"a".repeat(40)}`);
  });

  it("rejects an unknown target", () => {
    expect(() => resolveTarget("nope")).toThrow(/Unknown hosted-demo deploy target: nope/);
    expect(() => resolveTarget(undefined)).toThrow(/target is required/i);
    expect(resolveTarget("shop")).toBe(TARGETS.shop);
  });

  it("takes editor authoring and host routes from the verified editor manifest", () => {
    const routes = demoEditorRoutes(["/", "/host-specific"]);
    expect(TARGETS["sample-editor"].liveRoutes({ routes })).toEqual(routes);
    expect(routes).toContain("/composer");
    expect(routes).toContain("/review");
    expect(routes).toContain("/site/host-specific");
    expect(() => TARGETS["sample-editor"].liveRoutes({})).toThrow("routes must be an array");
  });

  it("reads a static demo site's live routes from its own manifest", () => {
    expect(TARGETS.shop.liveRoutes({ routes: ["/", "/about"] })).toEqual(["/", "/about"]);
  });

  it("maps sample styleguide routes and assets through the doc-site target", () => {
    const target = TARGETS["sample-sg"];
    expect(target.routeFile?.("/", {})).toBe("index.html");
    expect(target.routeFile?.("/components/", {})).toBe("components/index.html");
    expect(target.routeFile?.("/components/cta-button/", {})).toBe("components/cta-button/index.html");
    expect(target.assetUrl?.("assets/styles-abc.css")).toBe("/assets/styles-abc.css");
    expect(target.assetUrl?.("theme-packs/default/meta.json")).toBe("/theme-packs/default/meta.json");
    expect(target.assetUrl?.("components/index.html")).toBeNull();
    expect(target.verifyArtifact).toBe(verifyDocSiteArtifact);
  });

  it("keeps every Wrangler config in parity with exactly one registered target", async () => {
    const root = resolve(import.meta.dirname, "../..");
    const configFiles = (await readdir(root)).filter((file) => /^wrangler.*\.jsonc$/u.test(file)).sort();
    expect(new Set(configFiles)).toEqual(new Set(TARGET_KEYS.map((key) => TARGETS[key].configPath).sort()));
    for (const key of TARGET_KEYS) {
      const target = TARGETS[key];
      const config = JSON.parse(await readFile(join(root, target.configPath), "utf8")) as {
        name: string;
        assets: { directory: string; not_found_handling: string };
        routes: Array<{ pattern: string; custom_domain?: boolean }>;
      };
      expect(config.name).toBe(target.workerName);
      expect(config.routes).toEqual([{ pattern: target.domain, custom_domain: true }]);
      expect(config.assets.directory.replace(/^\.\//u, "").split("/").join(sep)).toBe(relative(root, target.artifactDirectory));
      expect(config.assets.not_found_handling).toBe(target.kind === "doc-site" ? "404-page" : "single-page-application");
    }
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

    const artifact = await TARGETS.shop.verifyArtifact({ directory, expectedSourceRevision: sourceRevision });
    expect(artifact.files.map((file) => file.path)).toEqual(["assets/index-abc.js", "index.html", pinPath].sort());
    expect(artifact.files.find((file) => file.path === "index.html")).toMatchObject({ mime: "text/html" });
    expect(artifact.files.find((file) => file.path === pinPath)).toMatchObject({ mime: "image/png" });
    expect(artifact.manifest.projectId).toBe("demo-webshop");
    expect(artifact.root.endsWith(directory.split("/").pop()!)).toBe(true);
    await expect(TARGETS.shop.verifyArtifact({ directory, expectedSourceRevision: "c".repeat(40) })).rejects.toThrow(/sourceRevision does not match/);
    // Local artifacts can omit a revision or use another revision system;
    // the existing production target contract still requires a full Git SHA.
    for (const sourceRevision of [undefined, "release-local"]) {
      await writeFile(join(directory, SITE_MANIFEST), JSON.stringify({ ...manifest, sourceRevision }));
      await expect(verifySiteStaticArtifact({ directory })).resolves.toMatchObject({ projectId: "demo-webshop" });
      await expect(TARGETS.shop.verifyArtifact({ directory })).rejects.toThrow(/Deployed site artifact requires/);
      await expect(TARGETS.shop.verifyArtifact({ directory, expectedSourceRevision: "a".repeat(40) })).rejects.toThrow(/sourceRevision does not match/);
    }
  });
});
