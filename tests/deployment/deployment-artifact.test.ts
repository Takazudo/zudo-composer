import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createArtifactManifest,
  deploymentCredentialState,
  sha256,
  verifyDeployment,
} from "../../scripts/deployment-artifact-lib.mjs";

async function fixture() {
  const dist = await mkdtemp(join(tmpdir(), "zudo-composer-deploy-"));
  await mkdir(join(dist, "assets"));
  await writeFile(join(dist, "index.html"), "<main>app</main>");
  await writeFile(join(dist, "assets/app.js"), "export const ready = true;");
  await writeFile(join(dist, "assets/app.css"), ".app{display:block}");
  await writeFile(join(dist, "assets/render.wasm"), Buffer.from([0, 97, 115, 109]));
  return dist;
}

describe("deployment artifact contract", () => {
  it("creates a deterministic sorted SHA/MIME manifest", async () => {
    const dist = await fixture();
    const manifest = await createArtifactManifest(dist);
    expect(manifest.files.map(({ path }) => path)).toEqual([
      "assets/app.css",
      "assets/app.js",
      "assets/render.wasm",
      "index.html",
    ]);
    expect(manifest.files).toMatchObject([
      { mime: "text/css" },
      { mime: "text/javascript" },
      { mime: "application/wasm" },
      { mime: "text/html" },
    ]);
  });

  it("checks every emitted file and every SPA route against exact bytes and MIME", async () => {
    const dist = await fixture();
    const manifest = await createArtifactManifest(dist);
    const byPath = new Map(manifest.files.map((file) => [`/${file.path}`, file]));
    const fetchImpl = async (input: URL | RequestInfo) => {
      const path = new URL(String(input)).pathname;
      const file = byPath.get(path) ?? byPath.get("/index.html")!;
      const bytes = path.startsWith("/assets/")
        ? await readFile(join(dist, file.path))
        : Buffer.from("<main>app</main>");
      return new Response(bytes, { headers: { "content-type": `${file.mime}; charset=utf-8` } });
    };
    const proof = await verifyDeployment({ baseUrl: "https://example.test", distDirectory: dist, fetchImpl });
    expect(proof.results).toHaveLength(manifest.files.length + 3);
    expect(proof.results.every(({ sha256: digest }) => /^[a-f0-9]{64}$/.test(digest))).toBe(true);
  });

  it("rejects changed bytes and wrong MIME", async () => {
    const dist = await fixture();
    await expect(verifyDeployment({
      baseUrl: "https://example.test",
      distDirectory: dist,
      fetchImpl: async () => new Response("changed", { headers: { "content-type": "text/html" } }),
    })).rejects.toThrow(/SHA-256/);

    const index = Buffer.from("<main>app</main>");
    await expect(verifyDeployment({
      baseUrl: "https://example.test",
      distDirectory: dist,
      fetchImpl: async () => new Response(index, { headers: { "content-type": "text/plain" } }),
    })).rejects.toThrow(/expected text\/html/);
    expect(sha256(index)).toHaveLength(64);
  });

  it("distinguishes absent, partial, and complete credentials", () => {
    expect(deploymentCredentialState({})).toBe("absent");
    expect(deploymentCredentialState({ CLOUDFLARE_API_TOKEN: "token" })).toBe("partial");
    expect(deploymentCredentialState({ CLOUDFLARE_ACCOUNT_ID: "account" })).toBe("partial");
    expect(deploymentCredentialState({ CLOUDFLARE_API_TOKEN: "token", CLOUDFLARE_ACCOUNT_ID: "account" })).toBe("complete");
    expect(deploymentCredentialState({ CLOUDFLARE_API_TOKEN: " ", CLOUDFLARE_ACCOUNT_ID: " " })).toBe("absent");
  });
});
