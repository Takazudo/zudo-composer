import { describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import type { InlineConfig, Plugin, ViteDevServer } from "vite";
import { APP_ROOT } from "../../plugins/roots.mjs";
import { installAuthoringShutdown } from "../edit/authoring-shutdown.mjs";

const createServer = vi.hoisted(() => vi.fn());
vi.mock("vite", async importOriginal => ({ ...await importOriginal<typeof import("vite")>(), createServer }));
import { startComposerDevServer } from "../dev-server.mjs";

function fixture() {
  const close = vi.fn(async () => {}), release = vi.fn(async () => {});
  const server = {
    close, listen: vi.fn(async () => {}), ws: { close: vi.fn(async () => {}) }, httpServer: null,
    middlewares: { stack: [], use: vi.fn() },
  } as unknown as ViteDevServer;
  installAuthoringShutdown(server, { release });
  return { server, close, release };
}

async function capture(config: InlineConfig, server: ViteDevServer) {
  const plugin = config.plugins![0] as Plugin;
  expect(plugin.name).toBe("zudo-authoring-boot-cleanup");
  expect(plugin.enforce).toBe("pre");
  const hook = plugin.configureServer;
  if (typeof hook !== "function") throw new Error("Missing early cleanup hook");
  await hook.call({} as never, server);
}

describe("authoring boot failure cleanup", () => {
  it("closes the captured server after a later configure hook fails", async () => {
    const f = fixture();
    createServer.mockImplementationOnce(async config => { await capture(config, f.server); throw new Error("later plugin failed"); });
    await expect(startComposerDevServer({ workspaceRoot: resolve(APP_ROOT, "fixtures/host") })).rejects.toThrow("later plugin failed");
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.release).toHaveBeenCalledOnce();
  });
  it("closes the captured server after listen fails", async () => {
    const f = fixture();
    vi.mocked(f.server.listen).mockRejectedValueOnce(new Error("port occupied"));
    createServer.mockImplementationOnce(async config => { await capture(config, f.server); return f.server; });
    await expect(startComposerDevServer({ workspaceRoot: resolve(APP_ROOT, "fixtures/host") })).rejects.toThrow("port occupied");
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.release).toHaveBeenCalledOnce();
  });
});
