import { expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startHostedDemoStaticServer } from "./static-server.mjs";

it("serves artifact MIME types and SPA routes while keeping missing uploads 404", async () => {
  const root = await mkdtemp(join(tmpdir(), "zudo-hosted-static-test-"));
  try {
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "index.html"), "<!doctype html><title>Hosted demo</title>");
    await writeFile(join(root, "assets/app.js"), "console.log('hosted');");
    await writeFile(join(root, "assets/pixel.png"), Buffer.from([137, 80, 78, 71]));
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
