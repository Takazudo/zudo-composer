import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createArtifactManifest,
  deploymentCredentialState,
  HTTP_TIMEOUT_MS,
  SPA_ROUTES,
  sha256,
  verifyDeployment,
  verifyLiveDeployment,
} from "../../scripts/deployment-artifact-lib.mjs";

async function fixture() {
  const dist = await mkdtemp(join(tmpdir(), "zudo-composer-deploy-"));
  await mkdir(join(dist, "assets"));
  await mkdir(join(dist, "uploaded-media"));
  await writeFile(join(dist, "index.html"), "<main>app</main>");
  await writeFile(join(dist, "assets/app.js"), "export const ready = true;");
  await writeFile(join(dist, "assets/app.css"), ".app{display:block}");
  await writeFile(join(dist, "assets/render.wasm"), Buffer.from([0, 97, 115, 109]));
  await Promise.all([
    ["sample.gif", Buffer.from("GIF89a")],
    ["sample.jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xd9])],
    ["sample.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xd9])],
    ["sample.pdf", Buffer.from("%PDF-1.4\n%%EOF\n")],
    ["sample.png", Buffer.from([0x89, 0x50, 0x4e, 0x47])],
    ["sample.webp", Buffer.from("RIFF0000WEBP")],
  ].map(([name, bytes]) => writeFile(join(dist, "uploaded-media", name as string), bytes)));
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
      "uploaded-media/sample.gif",
      "uploaded-media/sample.jpeg",
      "uploaded-media/sample.jpg",
      "uploaded-media/sample.pdf",
      "uploaded-media/sample.png",
      "uploaded-media/sample.webp",
    ]);
    expect(manifest.files).toMatchObject([
      { mime: "text/css" },
      { mime: "text/javascript" },
      { mime: "application/wasm" },
      { mime: "text/html" },
      { mime: "image/gif" },
      { mime: "image/jpeg" },
      { mime: "image/jpeg" },
      { mime: "application/pdf" },
      { mime: "image/png" },
      { mime: "image/webp" },
    ]);
  });

  it("checks every emitted file and every SPA route against exact bytes and MIME", async () => {
    const dist = await fixture();
    const manifest = await createArtifactManifest(dist);
    const byPath = new Map(manifest.files.map((file) => [`/${file.path}`, file]));
    const requestSignals: AbortSignal[] = [];
    const fetchImpl = async (input: URL | RequestInfo, init?: RequestInit) => {
      requestSignals.push(init?.signal as AbortSignal);
      const path = new URL(String(input)).pathname;
      const requestedFile = byPath.get(path);
      const file = requestedFile ?? byPath.get("/index.html")!;
      const bytes = requestedFile ? await readFile(join(dist, file.path)) : Buffer.from("<main>app</main>");
      return new Response(bytes, { headers: { "content-type": `${file.mime}; charset=utf-8` } });
    };
    const proof = await verifyDeployment({ baseUrl: "https://example.test", distDirectory: dist, fetchImpl });
    expect(proof.results).toHaveLength(manifest.files.length - 1 + SPA_ROUTES.length);
    expect(proof.results.every(({ sha256: digest }) => /^[a-f0-9]{64}$/.test(digest))).toBe(true);
    expect(requestSignals).toHaveLength(proof.results.length);
    expect(requestSignals.every((signal) => signal instanceof AbortSignal && !signal.aborted)).toBe(true);
    expect(HTTP_TIMEOUT_MS).toBe(10_000);
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

  it("aborts a stalled HTTP request at the configured bound", async () => {
    const dist = await fixture();
    const fetchImpl = (_input: URL | RequestInfo, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
    await expect(verifyDeployment({
      baseUrl: "https://example.test",
      distDirectory: dist,
      fetchImpl,
      requestTimeoutMs: 5,
    })).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("distinguishes absent, partial, and complete credentials", () => {
    expect(deploymentCredentialState({})).toBe("absent");
    expect(deploymentCredentialState({ CLOUDFLARE_API_TOKEN: "token" })).toBe("partial");
    expect(deploymentCredentialState({ CLOUDFLARE_ACCOUNT_ID: "account" })).toBe("partial");
    expect(deploymentCredentialState({ CLOUDFLARE_API_TOKEN: "token", CLOUDFLARE_ACCOUNT_ID: "account" })).toBe("complete");
    expect(deploymentCredentialState({ CLOUDFLARE_API_TOKEN: " ", CLOUDFLARE_ACCOUNT_ID: " " })).toBe("absent");
  });

  it("retries live propagation with bounded backoff and keeps the final proof strict", async () => {
    const dist = await fixture();
    const manifest = await createArtifactManifest(dist);
    const byPath = new Map(manifest.files.map((file) => [`/${file.path}`, file]));
    let requests = 0;
    const delays: number[] = [];
    const retries: number[] = [];
    const fetchImpl = async (input: URL | RequestInfo) => {
      requests += 1;
      if (requests === 1) throw new Error("DNS is not ready");
      const path = new URL(String(input)).pathname;
      const requestedFile = byPath.get(path);
      const file = requestedFile ?? byPath.get("/index.html")!;
      const bytes = requestedFile ? await readFile(join(dist, file.path)) : Buffer.from("<main>app</main>");
      return new Response(bytes, { headers: { "content-type": file.mime } });
    };
    const proof = await verifyLiveDeployment({
      baseUrl: "https://example.test",
      distDirectory: dist,
      fetchImpl,
      retryDelaysMs: [5],
      delayImpl: async (milliseconds) => { delays.push(milliseconds); },
      onRetry: ({ attempt }) => { retries.push(attempt); },
    });
    expect(proof.results).toHaveLength(manifest.files.length - 1 + SPA_ROUTES.length);
    expect(delays).toEqual([5]);
    expect(retries).toEqual([1]);

    await expect(verifyLiveDeployment({
      baseUrl: "https://example.test",
      distDirectory: dist,
      fetchImpl: async () => new Response("stale", { headers: { "content-type": "text/html" } }),
      retryDelaysMs: [1, 2],
      delayImpl: async (milliseconds) => { delays.push(milliseconds); },
    })).rejects.toThrow(/SHA-256/);
  });
});
