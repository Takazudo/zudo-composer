// @vitest-environment node

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { HOSTED_DEMO_LIVE_ROUTES, verifyLiveDeployment, verifyLiveWithRetries, verifyNavigationHtml } from "./live-check.mjs";
import { expectedMime } from "./artifact.mjs";
import { ASSET_CHECKSUM_URL_PATTERN, ASSET_IMMUTABLE_CACHE_CONTROL, ASSET_NOSNIFF, assetContentDisposition } from "../../src/assets/model/asset-kinds.mjs";

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
  const assets = Object.fromEntries([...files].map(([path, content]) => [path, createHash("sha256").update(content).digest("hex")]));
  await Promise.all([...files].map(([path, content]) => writeFile(join(root, path), content)));
  const manifest = { schemaVersion: 1, sourceRevision: SOURCE_REVISION, projectSourceRevision: PROJECT_REVISION, mode: "disposable-hosted-demo", assets };
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
    const routeRequest = mock.requests.find(({ path }) => path === "/composer");
    expect(routeRequest?.init?.headers).toEqual({ accept: "text/html", "sec-fetch-mode": "navigate" });
    const assetRequest = mock.requests.find(({ path }) => path.startsWith("/uploaded-assets/"));
    expect(assetRequest?.init?.headers).toEqual({});
    expect(mock.requests.every(({ url }) => url.searchParams.get("hosted-demo-revision") === SOURCE_REVISION)).toBe(true);
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
