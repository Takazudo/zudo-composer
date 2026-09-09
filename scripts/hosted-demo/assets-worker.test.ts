import { it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { MessageChannel } from "node:worker_threads";
it("assets worker reads only the requesting client and fails closed for unrelated uploads", async () => {
  const listeners = new Map<string, (event: unknown) => void>();
  const a = { postMessage(_request: unknown, ports: import("node:worker_threads").MessagePort[]) { ports[0]!.postMessage({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" }); ports[0]!.close(); } };
  const b = { postMessage(_request: unknown, ports: import("node:worker_threads").MessagePort[]) { ports[0]!.postMessage(null); ports[0]!.close(); } };
  const get = vi.fn(async (id: string) => id === "a" ? a : id === "b" ? b : null);
  const fetch = vi.fn(async () => new Response("seed", { headers: { "content-type": "image/png" } }));
  const seedPath = `/uploaded-assets/sha256-${"a".repeat(64)}.png`;
  runInNewContext(await readFile(resolve("scripts/hosted-demo/assets-worker.js"), "utf8"), { self: { addEventListener: (name: string, callback: (event: unknown) => void) => listeners.set(name, callback), location: { origin: "https://demo.example" }, clients: { get } }, bundledAssetPaths: [seedPath], URL, Response, MessageChannel, setTimeout, clearTimeout, fetch });
  async function request(clientId: string, path: string) { let reply: Promise<Response> | undefined; listeners.get("fetch")!({ clientId, request: { url: `https://demo.example${path}` }, respondWith(value: Promise<Response>) { reply = value; } }); return reply!; }
  const unknownPath = `/uploaded-assets/sha256-${"b".repeat(64)}.png`;
  expect(new Uint8Array(await (await request("a", unknownPath)).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  expect((await request("b", unknownPath)).status).toBe(404);
  expect((await request("", unknownPath)).status).toBe(404);
  expect(fetch).not.toHaveBeenCalled();
  expect(await (await request("b", seedPath)).text()).toBe("seed");
  expect(get.mock.calls.map(([id]) => id)).toEqual(["a", "b", "b"]);
});
