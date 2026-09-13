import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startHostedDemoStaticServer } from "./static-server.mjs";

it("serves artifact MIME types and SPA routes while keeping missing uploads 404", async () => {
  const root = await mkdtemp(join(tmpdir(), "zudo-hosted-static-test-"));
  try {
    await mkdir(join(root, "assets"));
    await mkdir(join(root, "uploaded-assets"));
    await writeFile(join(root, "index.html"), "<!doctype html><title>Hosted demo</title>");
    await writeFile(join(root, "assets/app.js"), "console.log('hosted');");
    await writeFile(join(root, "assets/pixel.png"), Buffer.from([137, 80, 78, 71]));
    await writeFile(join(root, "_headers"), "/uploaded-assets/*\n  X-Content-Type-Options: nosniff\n");
    const checksum = "a".repeat(64);
    await writeFile(join(root, `uploaded-assets/sha256-${checksum}.zip`), Buffer.from([80, 75, 3, 4, 1, 2]));
    const hosted = await startHostedDemoStaticServer({ directory: root, port: 0 });
    try {
      const html = await fetch(`${hosted.url}/composer`, { headers: { accept: "text/html" } });
      expect(html.status).toBe(200);
      expect(html.headers.get("content-type")).toMatch(/^text\/html;/u);
      expect(await html.text()).toContain("Hosted demo");

      const script = await fetch(`${hosted.url}/assets/app.js`);
      expect(script.status).toBe(200);
      expect(script.headers.get("content-type")).toMatch(/^text\/javascript;/u);

      const image = await fetch(`${hosted.url}/assets/pixel.png`);
      expect(image.status).toBe(200);
      expect(image.headers.get("content-type")).toBe("image/png");
      expect(Buffer.from(await image.arrayBuffer())).toEqual(await readFile(join(root, "assets/pixel.png")));

      const zipUrl = `${hosted.url}/uploaded-assets/sha256-${checksum}.zip`;
      const zip = await fetch(zipUrl);
      expect(zip.status).toBe(200);
      expect(zip.headers.get("content-type")).toBe("application/zip");
      expect(zip.headers.get("content-disposition")).toBe(`attachment; filename="${checksum}.zip"`);
      expect(zip.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(zip.headers.get("x-content-type-options")).toBe("nosniff");
      expect(zip.headers.get("content-length")).toBe("6");
      const zipHead = await fetch(zipUrl, { method: "HEAD" });
      expect(zipHead.status).toBe(200);
      for (const name of ["content-type", "content-disposition", "cache-control", "x-content-type-options", "content-length"]) expect(zipHead.headers.get(name)).toBe(zip.headers.get(name));
      expect(await zipHead.text()).toBe("");

      expect((await fetch(`${hosted.url}/_headers`, { headers: { accept: "text/html" } })).status).toBe(404);
      expect((await fetch(`${hosted.url}/missing.js`, { headers: { accept: "text/html" } })).status).toBe(404);
      expect((await fetch(`${hosted.url}/uploaded-assets/missing.png`, { headers: { accept: "text/html" } })).status).toBe(404);
      expect((await fetch(`${hosted.url}/composer`, { method: "HEAD", headers: { accept: "text/html" } })).status).toBe(200);
      expect((await fetch(`${hosted.url}/composer`, { method: "POST" })).status).toBe(405);
    } finally {
      await hosted.close();
      await hosted.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function withArtifact(files: Record<string, string | Buffer>, check: (hosted: Awaited<ReturnType<typeof startHostedDemoStaticServer>>) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "zudo-multipage-static-test-"));
  try {
    await Promise.all(Object.entries(files).map(async ([path, content]) => {
      await mkdir(join(root, path, ".."), { recursive: true });
      await writeFile(join(root, path), content);
    }));
    const hosted = await startHostedDemoStaticServer({ directory: root, port: 0 });
    try {
      await check(hosted);
    } finally {
      await hosted.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const MULTI_PAGE_FILES = {
  "index.html": "<!doctype html><title>Home</title>",
  "docs/a/index.html": "<!doctype html><title>Document A</title>",
  "about.html": "<!doctype html><title>About</title>",
  "404.html": "<!doctype html><title>Missing page</title>",
};

describe("multi-page static routing", () => {
  it("serves directory indexes and extensionless HTML files independently of navigation headers", async () => {
    await withArtifact(MULTI_PAGE_FILES, async ({ url }) => {
      for (const [path, file] of [["/", "index.html"], ["/docs/a/", "docs/a/index.html"], ["/about", "about.html"], ["/404", "404.html"]] as const) {
        const response = await fetch(`${url}${path}`, { redirect: "error" });
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
        expect(await response.text()).toBe(MULTI_PAGE_FILES[file]);
      }
      const head = await fetch(`${url}/docs/a/`, { method: "HEAD", redirect: "error" });
      expect(head.status).toBe(200);
      expect(head.headers.get("content-length")).toBe(String(Buffer.byteLength(MULTI_PAGE_FILES["docs/a/index.html"])));
      expect(await head.text()).toBe("");
    });
  });

  it("redirects HTML filenames and noncanonical trailing slashes with status 308", async () => {
    await withArtifact(MULTI_PAGE_FILES, async ({ url }) => {
      for (const [path, canonical] of [["/index.html", "/"], ["/docs/a/index.html", "/docs/a/"], ["/about.html", "/about"], ["/404.html", "/404"], ["/docs/a", "/docs/a/"], ["/about/", "/about"]]) {
        for (const method of ["GET", "HEAD"]) {
          const response = await fetch(`${url}${path}?from=test%2Fpage`, { method, redirect: "manual" });
          expect(response.status).toBe(308);
          expect(response.headers.get("location")).toBe(`${canonical}?from=test%2Fpage`);
          expect(await response.text()).toBe("");
        }
      }
    });
  });

  it("preserves encoded filenames and queries in same-origin canonical redirects", async () => {
    const encodedPath = "/docs/a%20%23%3F%25/index.html";
    const document = "<!doctype html><title>Encoded path</title>";
    await withArtifact({ ...MULTI_PAGE_FILES, "docs/a #?%/index.html": document }, async ({ url }) => {
      const response = await fetch(`${url}${encodedPath}?q=a%2Fb`, { redirect: "manual" });
      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe("/docs/a%20%23%3F%25/?q=a%2Fb");
      expect(await (await fetch(`${url}${response.headers.get("location")}`, { redirect: "error" })).text()).toBe(document);
      const repeatedSlash = await fetch(`${url}/%2Fdocs/a/index.html`, { redirect: "manual" });
      expect(repeatedSlash.status).toBe(308);
      expect(repeatedSlash.headers.get("location")).toBe("/docs/a/");
    });
  });

  it("serves custom 404 HTML with status 404 while missing assets stay missing", async () => {
    await withArtifact(MULTI_PAGE_FILES, async ({ url }) => {
      for (const path of ["/unknown", "/docs/unknown/"]) {
        for (const accept of ["text/html", "*/*"]) {
          const response = await fetch(`${url}${path}`, { headers: { accept }, redirect: "error" });
          expect(response.status).toBe(404);
          expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
          expect(await response.text()).toBe(MULTI_PAGE_FILES["404.html"]);
        }
      }
      const head = await fetch(`${url}/unknown`, { method: "HEAD" });
      expect(head.status).toBe(404);
      expect(head.headers.get("content-length")).toBe(String(Buffer.byteLength(MULTI_PAGE_FILES["404.html"])));
      expect(await head.text()).toBe("");
      for (const path of ["/missing.css", "/missing.html", "/uploaded-assets/missing", "/uploaded-assets/missing.png", "/_headers", "/..%2Foutside"]) {
        const response = await fetch(`${url}${path}`, { headers: { accept: "text/html" }, redirect: "error" });
        expect(response.status).toBe(404);
        expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
        expect(await response.text()).toBe("Not found");
      }
    });
  });

  it("keeps the SPA fallback for unknown HTML navigation when no custom 404 exists", async () => {
    await withArtifact({ "index.html": MULTI_PAGE_FILES["index.html"], "docs/a/index.html": MULTI_PAGE_FILES["docs/a/index.html"] }, async ({ url }) => {
      const response = await fetch(`${url}/unknown`, { headers: { accept: "text/html" }, redirect: "error" });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(MULTI_PAGE_FILES["index.html"]);
      expect((await fetch(`${url}/unknown`, { redirect: "error" })).status).toBe(404);
      expect(await (await fetch(`${url}/docs/a/`, { redirect: "error" })).text()).toBe(MULTI_PAGE_FILES["docs/a/index.html"]);
    });
  });

  it("retains existing root-index and navigation behavior for an SPA artifact", async () => {
    await withArtifact({ "index.html": MULTI_PAGE_FILES["index.html"] }, async ({ url }) => {
      const index = await fetch(`${url}/index.html`, { redirect: "manual" });
      expect(index.status).toBe(200);
      expect(index.headers.get("location")).toBeNull();
      expect(await index.text()).toBe(MULTI_PAGE_FILES["index.html"]);
      expect((await fetch(`${url}/`, { redirect: "error" })).status).toBe(404);
      expect((await fetch(`${url}/composer`, { redirect: "error" })).status).toBe(404);
      const navigation = await fetch(`${url}/composer`, { headers: { accept: "text/html" }, redirect: "error" });
      expect(navigation.status).toBe(200);
      expect(await navigation.text()).toBe(MULTI_PAGE_FILES["index.html"]);
    });
  });

  it("serves the MIME types needed by a documentation site", async () => {
    const assets = [
      ["logo.svg", "image/svg+xml", "<svg></svg>"],
      ["sitemap.xml", "application/xml", "<urlset></urlset>"],
      ["robots.txt", "text/plain; charset=utf-8", "User-agent: *\n"],
      ["favicon.ico", "image/vnd.microsoft.icon", Buffer.from([0, 0, 1, 0])],
      ["font.woff2", "font/woff2", Buffer.from("wOF2")],
      ["site.webmanifest", "application/manifest+json", "{}"],
    ] as const;
    await withArtifact({ ...MULTI_PAGE_FILES, ...Object.fromEntries(assets.map(([path, , body]) => [path, body])) }, async ({ url }) => {
      for (const [path, mime, body] of assets) {
        const response = await fetch(`${url}/${path}`, { redirect: "error" });
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe(mime);
        expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(body));
      }
    });
  });
});
