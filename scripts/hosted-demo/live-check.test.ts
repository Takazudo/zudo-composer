// @vitest-environment node

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HOSTED_DEMO_LIVE_ROUTES, verifyLiveDeployment, verifyLiveWithRetries, verifyNavigationHtml } from "./live-check.mjs";
import { HOSTED_DEMO_HEADERS, expectedMime, verifyHostedDemoArtifact } from "./artifact.mjs";
import { TARGETS } from "./targets.mjs";
import { SITE_HEADERS, SITE_MANIFEST, createSiteManifest, readToolIdentity, siteHeaders } from "../../server/site-build/artifact.mjs";
import { ASSET_CHECKSUM_URL_PATTERN, ASSET_IMMUTABLE_CACHE_CONTROL, ASSET_NOSNIFF, assetContentDisposition, hostedAssetHeaders } from "../../src/assets/model/asset-kinds.mjs";

const SOURCE_REVISION = "c".repeat(40);
const PROJECT_REVISION = "d".repeat(64);
const BEACON = `<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js/v31edd6df95cf4e85bb4c19e7a9bdbcba1788362987495" integrity="sha512-iIg7k2xntmwu6/uSb5tpc/hySgZc4eoL31yB29W6tJFo2akwjPWcEqnCEdJvGexCL0KEQwVYv5BlowfhVz26hg==" data-cf-beacon='{"version":"2024.11.0","token":"${"a".repeat(32)}","r":1,"spa":2}' crossorigin="anonymous"></script>\n`;

async function writeArtifact() {
  const root = await mkdtemp(join(tmpdir(), "hosted-live-check-"));
  await mkdir(join(root, "assets"), { recursive: true });
  await mkdir(join(root, "uploaded-assets"), { recursive: true });
  const files = new Map<string, Buffer>([
    ["index.html", Buffer.from("<!doctype html><html><body>live</body></html>\n")],
    ["hosted-demo-assets-worker.js", Buffer.from("export default {};\n")],
    ["assets/preview-entry-test.js", Buffer.from("export const preview = true;\n")],
  ]);
  for (const [content, extension] of [
    [Buffer.from("one"), "png"], [Buffer.from("two"), "png"], [Buffer.from("three"), "png"], [Buffer.from("four"), "png"],
    [Buffer.from("%PDF-1.7"), "pdf"], [Buffer.from([0x50, 0x4b, 0x03, 0x04]), "zip"],
  ] as const) {
    files.set(`uploaded-assets/sha256-${createHash("sha256").update(content).digest("hex")}.${extension}`, content);
  }
  files.set(HOSTED_DEMO_HEADERS, Buffer.from(hostedAssetHeaders([...files].filter(([path]) => path.startsWith("uploaded-assets/")).map(([path, bytes]) => ({ path, byteLength: bytes.byteLength })))));
  const assets = Object.fromEntries([...files].map(([path, content]) => [path, createHash("sha256").update(content).digest("hex")]));
  await Promise.all([...files].map(([path, content]) => writeFile(join(root, path), content)));
  const manifest = { schemaVersion: 1, tool: await readToolIdentity(), sourceRevision: SOURCE_REVISION, projectSourceRevision: PROJECT_REVISION, mode: "disposable-hosted-demo", assets };
  await writeFile(join(root, "hosted-demo-manifest.json"), JSON.stringify(manifest));
  return { root, manifest, files };
}

function response(body: string | Buffer | null, mime: string, status = 200, headers: Record<string, string> = {}) {
  return new Response(body, { status, headers: { "content-type": mime, ...headers } });
}

function mockFetch(fixture: Awaited<ReturnType<typeof writeArtifact>>, options: { corruptPath?: string; staleManifest?: boolean; injectAnalytics?: boolean } = {}) {
  const requests: Array<{ url: URL; path: string; init: RequestInit | undefined }> = [];
  const fetchImpl = async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(input.toString());
    const path = url.pathname;
    requests.push({ url, path, init });
    if (path === "/hosted-demo-manifest.json") {
      const manifest = options.staleManifest ? { ...fixture.manifest, sourceRevision: "e".repeat(40) } : fixture.manifest;
      return response(JSON.stringify(manifest), "application/json");
    }
    if (HOSTED_DEMO_LIVE_ROUTES.includes(path)) {
      const navigation = new Headers(init?.headers).get("sec-fetch-mode") === "navigate";
      const html = fixture.files.get("index.html")!.toString();
      return response(options.injectAnalytics && navigation ? html.replace("</body>", `${BEACON}</body>`) : html, "text/html");
    }
    const relative = path.slice(1);
    const bytes = fixture.files.get(relative);
    if (!bytes) return response("missing", "text/plain", 404);
    const asset = ASSET_CHECKSUM_URL_PATTERN.test(`/${relative}`);
    const mime = asset ? expectedMime(relative) : relative.endsWith(".png") ? "image/png" : "text/javascript";
    const checksum = asset ? relative.slice("uploaded-assets/sha256-".length, relative.lastIndexOf(".")) : undefined;
    const headers = asset ? {
      "content-length": String((relative === options.corruptPath ? Buffer.from("changed") : bytes).byteLength),
      "cache-control": ASSET_IMMUTABLE_CACHE_CONTROL,
      "x-content-type-options": ASSET_NOSNIFF,
      ...(checksum === undefined || assetContentDisposition(mime, checksum) === undefined ? {} : { "content-disposition": assetContentDisposition(mime, checksum)! }),
    } : {};
    return response(relative === options.corruptPath ? Buffer.from("changed") : bytes, mime, 200, headers);
  };
  return { fetchImpl, requests };
}

const fixtures: string[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("hosted demo live verification", () => {
  it("requires the tool identity and full Git SHA while retaining exact trusted revision comparison", async () => {
    const fixture = await writeArtifact();
    fixtures.push(fixture.root);
    const path = join(fixture.root, "hosted-demo-manifest.json");
    for (const changes of [{ tool: undefined }, { tool: { name: "zudo-composer" } }, { sourceRevision: undefined }, { sourceRevision: "release-local" }]) {
      await writeFile(path, JSON.stringify({ ...fixture.manifest, ...changes }));
      await expect(verifyHostedDemoArtifact({ directory: fixture.root })).rejects.toThrow();
    }
    await writeFile(path, JSON.stringify(fixture.manifest));
    await expect(verifyHostedDemoArtifact({ directory: fixture.root, expectedSourceRevision: "0".repeat(40) })).rejects.toThrow(/sourceRevision does not match/);
    expect((await verifyHostedDemoArtifact({ directory: fixture.root, expectedSourceRevision: SOURCE_REVISION })).manifest.tool).toEqual(fixture.manifest.tool);
  });

  it("checks the exact manifest, routes and assets and separates navigation headers", async () => {
    const fixture = await writeArtifact();
    fixtures.push(fixture.root);
    const mock = mockFetch(fixture);
    const proof = await verifyLiveDeployment({
      baseUrl: "https://demo.example.test",
      artifactDirectory: fixture.root,
      expectedSourceRevision: SOURCE_REVISION,
      fetchImpl: mock.fetchImpl,
    });
    expect(proof.routes.map(({ path }) => path)).toEqual(HOSTED_DEMO_LIVE_ROUTES);
    expect(proof.assets).toHaveLength(9);
    expect(mock.requests.some(({ path }) => path === "/_headers")).toBe(false);
    const routeRequest = mock.requests.find(({ path }) => path === "/composer");
    expect(routeRequest?.init?.headers).toEqual({ accept: "text/html", "sec-fetch-mode": "navigate" });
    const assetRequest = mock.requests.find(({ path }) => path.startsWith("/uploaded-assets/"));
    expect(assetRequest?.init?.headers).toEqual({});
    expect(mock.requests.every(({ url }) => url.searchParams.get("hosted-demo-revision") === SOURCE_REVISION)).toBe(true);
  });

  it("rejects missing or weakened deployment header rules even with an updated manifest", async () => {
    const fixture = await writeArtifact();
    fixtures.push(fixture.root);
    const headers = fixture.files.get(HOSTED_DEMO_HEADERS)!.toString();
    expect(headers).toContain("Content-Disposition: attachment;");
    expect(headers.match(/Content-Disposition:/g)).toHaveLength(1);
    for (const content of ["", headers.replaceAll("max-age=31536000, immutable", "max-age=0")]) {
      await writeFile(join(fixture.root, HOSTED_DEMO_HEADERS), content);
      fixture.manifest.assets[HOSTED_DEMO_HEADERS] = createHash("sha256").update(content).digest("hex");
      await writeFile(join(fixture.root, "hosted-demo-manifest.json"), JSON.stringify(fixture.manifest));
      await expect(verifyHostedDemoArtifact({ directory: fixture.root })).rejects.toThrow("header rules must match");
    }
  });

  it("permits Cloudflare navigation analytics while checking the original HTML bytes separately", async () => {
    const fixture = await writeArtifact();
    fixtures.push(fixture.root);
    const mock = mockFetch(fixture, { injectAnalytics: true });
    const proof = await verifyLiveDeployment({ baseUrl: "https://demo.example.test", artifactDirectory: fixture.root, fetchImpl: mock.fetchImpl });
    expect(proof.routes.every((route) => route.cloudflareAnalyticsInjected)).toBe(true);
    expect(proof.assets.find((asset) => asset.path === "index.html")?.sha256).toBe(fixture.manifest.assets["index.html"]);
    expect(mock.requests.filter(({ path }) => path === "/").map(({ init }) => new Headers(init?.headers).get("sec-fetch-mode"))).toEqual(["navigate", null]);
  });

  it("rejects changed application HTML, arbitrary scripts and duplicate analytics injections", () => {
    const html = "<html><body>tested application</body></html>";
    const checksum = createHash("sha256").update(html).digest("hex");
    const inject = (script: string, content = html) => Buffer.from(content.replace("</body>", `${script}</body>`));
    expect(verifyNavigationHtml(Buffer.from(html), checksum).cloudflareAnalyticsInjected).toBe(false);
    expect(() => verifyNavigationHtml(inject(BEACON, html.replace("tested", "modified")), checksum)).toThrow(/changes beyond/);
    expect(() => verifyNavigationHtml(inject("<script>unexpected()</script>\n"), checksum)).toThrow(/recognized Cloudflare/);
    expect(() => verifyNavigationHtml(inject(BEACON.replace("static.cloudflareinsights.com", "untrusted.example")), checksum)).toThrow(/recognized Cloudflare/);
    expect(() => verifyNavigationHtml(inject(BEACON + BEACON), checksum)).toThrow();
    expect(() => verifyNavigationHtml(inject(BEACON.replace('"version":"2024.11.0"', '"version":null')), checksum)).toThrow(/unexpected configuration/);
  });

  it("rejects stale manifests and changed asset bytes", async () => {
    const fixture = await writeArtifact();
    fixtures.push(fixture.root);
    await expect(verifyLiveDeployment({
      baseUrl: "https://demo.example.test",
      artifactDirectory: fixture.root,
      expectedSourceRevision: SOURCE_REVISION,
      fetchImpl: mockFetch(fixture, { staleManifest: true }).fetchImpl,
    })).rejects.toThrow(/manifest does not match/);
    const assetPath = [...fixture.files.keys()].find((path) => path.startsWith("uploaded-assets/"))!;
    await expect(verifyLiveDeployment({
      baseUrl: "https://demo.example.test",
      artifactDirectory: fixture.root,
      expectedSourceRevision: SOURCE_REVISION,
      fetchImpl: mockFetch(fixture, { corruptPath: assetPath }).fetchImpl,
    })).rejects.toThrow(/response SHA-256 does not match/);
  });

  it("retries transient live failures within the caller's bounded delay policy", async () => {
    const fixture = await writeArtifact();
    fixtures.push(fixture.root);
    let attempt = 0;
    const retries: Array<{ attempt: number; delayMs: number }> = [];
    const proof = await verifyLiveWithRetries({
      baseUrl: "https://demo.example.test",
      artifactDirectory: fixture.root,
      expectedSourceRevision: SOURCE_REVISION,
      fetchImpl: async (input, init) => {
        const url = new URL(input.toString());
        if (url.pathname === "/hosted-demo-manifest.json" && attempt++ === 0) return mockFetch(fixture, { staleManifest: true }).fetchImpl(input, init);
        return mockFetch(fixture).fetchImpl(input, init);
      },
      retryDelaysMs: [25],
      delayImpl: async () => {},
      onRetry: ({ attempt: retryAttempt, delayMs }) => retries.push({ attempt: retryAttempt, delayMs }),
    });
    expect(proof.routes).toHaveLength(HOSTED_DEMO_LIVE_ROUTES.length);
    expect(retries).toEqual([{ attempt: 1, delayMs: 25 }]);
  });
});

describe("static demo site live verification (a non-default target)", () => {
  async function writeSiteArtifact() {
    const root = await mkdtemp(join(tmpdir(), "site-static-live-check-"));
    const indexHtml = Buffer.from("<!doctype html><html><body>site</body></html>\n");
    const pinBytes = Buffer.from("pinned");
    const pinPath = `uploaded-assets/sha256-${createHash("sha256").update(pinBytes).digest("hex")}.png`;
    const files = new Map<string, Buffer>([
      ["index.html", indexHtml],
      ["assets/index-abc.js", Buffer.from("console.log('site');\n")],
      [pinPath, pinBytes],
    ]);
    for (const [path, content] of files) {
      await mkdir(join(root, path, ".."), { recursive: true });
      await writeFile(join(root, path), content);
    }
    await writeFile(join(root, SITE_HEADERS), siteHeaders([{ path: pinPath, byteLength: pinBytes.byteLength }]));
    const manifest = await createSiteManifest({ directory: root, projectId: "demo-webshop", sourceRevision: SOURCE_REVISION, projectSourceRevision: PROJECT_REVISION, routes: ["/", "/about"] });
    await writeFile(join(root, SITE_MANIFEST), JSON.stringify(manifest));
    return { root, manifest, files };
  }

  function mockSiteFetch(fixture: Awaited<ReturnType<typeof writeSiteArtifact>>) {
    const requests: string[] = [];
    const fetchImpl = async (input: URL | RequestInfo) => {
      const url = new URL(input.toString());
      const path = url.pathname;
      requests.push(path);
      if (path === `/${SITE_MANIFEST}`) return response(JSON.stringify(fixture.manifest), "application/json");
      if (fixture.manifest.routes.includes(path)) return response(fixture.files.get("index.html")!.toString(), "text/html");
      const relative = path === "/" ? "index.html" : path.slice(1);
      const bytes = fixture.files.get(relative);
      if (!bytes) return response("missing", "text/plain", 404);
      const asset = ASSET_CHECKSUM_URL_PATTERN.test(path);
      const mime = asset ? expectedMime(relative) : relative.endsWith(".js") ? "text/javascript" : "text/html";
      const checksum = asset ? relative.slice("uploaded-assets/sha256-".length, relative.lastIndexOf(".")) : undefined;
      const headers = asset ? {
        "content-length": String(bytes.byteLength),
        "cache-control": ASSET_IMMUTABLE_CACHE_CONTROL,
        "x-content-type-options": ASSET_NOSNIFF,
        ...(checksum === undefined || assetContentDisposition(mime, checksum) === undefined ? {} : { "content-disposition": assetContentDisposition(mime, checksum)! }),
      } : {};
      return response(bytes, mime, 200, headers);
    };
    return { fetchImpl, requests };
  }

  it("verifies a static site target using its own manifest name, verifier and route list", async () => {
    const fixture = await writeSiteArtifact();
    fixtures.push(fixture.root);
    const mock = mockSiteFetch(fixture);
    const target = TARGETS.webshop;
    const proof = await verifyLiveDeployment({
      baseUrl: "https://zc-demo-shop.zudolab.dev",
      artifactDirectory: fixture.root,
      expectedSourceRevision: SOURCE_REVISION,
      fetchImpl: mock.fetchImpl,
      manifestFileName: target.manifestFileName,
      artifactVerifier: target.verifyArtifact,
      liveRoutes: target.liveRoutes,
    });
    expect(proof.routes.map(({ path }) => path)).toEqual(["/", "/about"]);
    expect(proof.assets.map(({ path }) => path).sort()).toEqual(["assets/index-abc.js", "index.html", [...fixture.files.keys()].find((path) => path.startsWith("uploaded-assets/"))].sort());
    expect(mock.requests.some((path) => path === "/_headers")).toBe(false);
    expect(mock.requests).toContain(`/${SITE_MANIFEST}`);
  });
});

describe("multi-page static site live verification", () => {
  function multiPageFixture(options: { injectAnalytics?: boolean; wrongPage?: boolean; corruptAsset?: string; staleFirstManifest?: boolean; routeMime?: string } = {}) {
    const files = new Map([
      ["index.html", Buffer.from("<!doctype html><html><body>Home</body></html>\n")],
      ["docs/a/index.html", Buffer.from("<!doctype html><html><body>Document A</body></html>\n")],
      ["404.html", Buffer.from("<!doctype html><html><body>Not found</body></html>\n")],
      ["assets/site.css", Buffer.from("body { color: black; }\n")],
    ]);
    const artifactFiles = [...files].map(([path, bytes]) => ({
      path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      mime: path.endsWith(".css") ? "text/css" : "text/html",
    }));
    const manifest = {
      sourceRevision: SOURCE_REVISION,
      routeFiles: { "/": "index.html", "/docs/a/": "docs/a/index.html" },
      files: Object.fromEntries(artifactFiles.map(({ path, sha256 }) => [path, sha256])),
    };
    const requests: Array<{ url: URL; init: RequestInit | undefined }> = [];
    let manifestRequests = 0;
    const fetchImpl = async (input: URL | string, init?: RequestInit) => {
      const url = new URL(input.toString());
      requests.push({ url, init });
      if (url.pathname === "/multi-page-manifest.json") {
        const remoteManifest = options.staleFirstManifest && manifestRequests++ === 0 ? { ...manifest, sourceRevision: "e".repeat(40) } : manifest;
        return response(JSON.stringify(remoteManifest), "application/json");
      }
      const path = ({ "/": "index.html", "/docs/a/": "docs/a/index.html", "/404": "404.html", "/assets/site.css": "assets/site.css" } as Record<string, string>)[url.pathname];
      if (!path) throw new Error(`Unexpected asset URL: ${url.pathname}`);
      const navigation = new Headers(init?.headers).get("sec-fetch-mode") === "navigate";
      const body = path === options.corruptAsset ? "changed" : files.get(options.wrongPage && url.pathname === "/docs/a/" ? "index.html" : path)!.toString();
      const mime = path.endsWith(".css") ? "text/css" : navigation ? options.routeMime ?? "text/html" : "text/html";
      return response(options.injectAnalytics && navigation ? body.replace("</body>", `${BEACON}</body>`) : body, mime);
    };
    const routeFile = vi.fn((route: string, routeManifest: Record<string, unknown>) => (routeManifest.routeFiles as Record<string, string>)[route]);
    const assetUrl = vi.fn((path: string) => path === "docs/a/index.html" ? null : path === "404.html" ? "/404" : path === "index.html" ? "/" : `/${path}`);
    return {
      manifest,
      requests,
      routeFile,
      assetUrl,
      options: {
        baseUrl: "https://multi-page.example.test",
        artifactDirectory: "/test/multi-page-artifact",
        expectedSourceRevision: SOURCE_REVISION,
        manifestFileName: "multi-page-manifest.json",
        artifactVerifier: async ({ directory }: { directory: string }) => ({ root: directory, manifest, files: artifactFiles }),
        liveRoutes: (routeManifest: Record<string, unknown>) => Object.keys(routeManifest.routeFiles as Record<string, string>),
        routeFile,
        assetUrl,
        fetchImpl,
      },
    };
  }

  it.each([false, true])("checks each route's HTML with analytics injection %s and maps canonical asset URLs", async (injectAnalytics) => {
    const fixture = multiPageFixture({ injectAnalytics });
    const proof = await verifyLiveDeployment(fixture.options);
    expect(proof.routes.map(({ path, sha256, cloudflareAnalyticsInjected }) => ({ path, sha256, cloudflareAnalyticsInjected }))).toEqual([
      { path: "/", sha256: fixture.manifest.files["index.html"], cloudflareAnalyticsInjected: injectAnalytics },
      { path: "/docs/a/", sha256: fixture.manifest.files["docs/a/index.html"], cloudflareAnalyticsInjected: injectAnalytics },
    ]);
    expect(fixture.routeFile.mock.calls).toEqual([["/", fixture.manifest], ["/docs/a/", fixture.manifest]]);
    expect(proof.assets.map(({ path }) => path)).toEqual(["index.html", "404.html", "assets/site.css"]);
    expect(fixture.requests.map(({ url }) => url.pathname)).toEqual([
      "/multi-page-manifest.json", "/", "/docs/a/", "/", "/404", "/assets/site.css",
    ]);
    expect(fixture.requests.every(({ url, init }) => url.searchParams.get("hosted-demo-revision") === SOURCE_REVISION && init?.redirect === "error")).toBe(true);
    expect(fixture.requests.find(({ url }) => url.pathname === "/404")?.init?.headers).toEqual({});
  });

  it.each([false, true])("rejects a wrong page body with analytics injection %s and identifies the route and expected file", async (injectAnalytics) => {
    const fixture = multiPageFixture({ wrongPage: true, injectAnalytics });
    await expect(verifyLiveDeployment(fixture.options)).rejects.toThrow(/\/docs\/a\/: navigation HTML does not match docs\/a\/index\.html/);
  });

  it("retains the route MIME check for a correctly mapped page", async () => {
    const fixture = multiPageFixture({ routeMime: "text/plain" });
    await expect(verifyLiveDeployment(fixture.options)).rejects.toThrow(/expected text\/html, received text\/plain/);
  });

  it("rejects a route mapping to a missing artifact file", async () => {
    const fixture = multiPageFixture();
    await expect(verifyLiveDeployment({ ...fixture.options, routeFile: () => "missing/index.html" })).rejects.toThrow(/\/: deploy artifact must include route file missing\/index\.html/);
  });

  it("requires navigation mappings to select HTML rather than bypass asset checks", async () => {
    const fixture = multiPageFixture();
    await expect(verifyLiveDeployment({ ...fixture.options, routeFile: () => "assets/site.css", assetUrl: () => null })).rejects.toThrow(/route file assets\/site\.css must be HTML, received text\/css/);
  });

  it("retains the root index requirement even if no routes are configured", async () => {
    const fixture = multiPageFixture();
    await expect(verifyLiveDeployment({
      ...fixture.options,
      liveRoutes: () => [],
      artifactVerifier: async (options) => {
        const artifact = await fixture.options.artifactVerifier(options);
        return { ...artifact, files: artifact.files.filter(({ path }) => path !== "index.html") };
      },
    })).rejects.toThrow("Deploy artifact must include index.html");
  });

  it("checks the exact bytes of 404.html at its mapped URL", async () => {
    const fixture = multiPageFixture({ corruptAsset: "404.html" });
    await expect(verifyLiveDeployment(fixture.options)).rejects.toThrow(/\/404\.html: response SHA-256 does not match/);
    expect(fixture.requests.some(({ url }) => url.pathname === "/404")).toBe(true);
  });

  it("refuses to skip an asset that no verified route covers", async () => {
    const fixture = multiPageFixture();
    await expect(verifyLiveDeployment({
      ...fixture.options,
      assetUrl: (path) => path === "assets/site.css" ? null : fixture.assetUrl(path),
    })).rejects.toThrow(/\/assets\/site\.css: asset fetch cannot be skipped without a verified route/);
  });

  it("forwards both hooks through bounded retries", async () => {
    const fixture = multiPageFixture({ staleFirstManifest: true, injectAnalytics: true });
    const onRetry = vi.fn();
    const proof = await verifyLiveWithRetries({ ...fixture.options, retryDelaysMs: [0], delayImpl: async () => {}, onRetry });
    expect(onRetry).toHaveBeenCalledOnce();
    expect(proof.routes[1]).toMatchObject({ path: "/docs/a/", sha256: fixture.manifest.files["docs/a/index.html"], cloudflareAnalyticsInjected: true });
    expect(proof.assets.map(({ path }) => path)).toEqual(["index.html", "404.html", "assets/site.css"]);
    expect(fixture.requests.filter(({ url }) => url.pathname.endsWith("/index.html"))).toHaveLength(0);
    expect(fixture.requests.filter(({ url }) => url.pathname === "/404")).toHaveLength(1);
  });

  it("retains immutable upload GET/HEAD header verification when its URL is mapped", async () => {
    const fixture = await writeArtifact();
    fixtures.push(fixture.root);
    const zipPath = [...fixture.files.keys()].find((path) => path.endsWith(".zip"))!;
    for (const weakenHeader of [false, true]) {
      const mock = mockFetch(fixture);
      const methods: string[] = [];
      const proof = verifyLiveDeployment({
        baseUrl: "https://demo.example.test",
        artifactDirectory: fixture.root,
        assetUrl: (path) => path === zipPath ? "/download.zip" : path === "index.html" ? "/" : `/${path}`,
        fetchImpl: async (input, init) => {
          const url = new URL(input.toString());
          const mapped = url.pathname === "/download.zip";
          if (mapped) {
            methods.push(init?.method ?? "GET");
            url.pathname = `/${zipPath}`;
          }
          const result = await mock.fetchImpl(url, init);
          if (mapped && weakenHeader) result.headers.delete("cache-control");
          return result;
        },
      });
      if (weakenHeader) {
        await expect(proof).rejects.toThrow(/immutable cache policy is missing/);
        expect(methods).toEqual(["GET"]);
      } else {
        expect((await proof).assets.some(({ path }) => path === zipPath)).toBe(true);
        expect(methods).toEqual(["GET", "HEAD"]);
      }
    }
  });
});
