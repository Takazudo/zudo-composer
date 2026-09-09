import { expect, it } from "vitest";
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
