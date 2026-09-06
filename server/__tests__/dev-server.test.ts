import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { APP_ROOT, resolvePublicDir } from "../../plugins/roots.mjs";
import { APP_ENTRY_MODULE } from "../../plugins/composer-app-html.mjs";
import { OPTIMIZE_DEPS_EXCLUDE, loadHostConfig, resolveComposerDevConfig, resolveFsAllow } from "../dev-server.mjs";
import { resolveComponentPack } from "../../plugins/component-pack.mjs";

const FIXTURE_HOST = resolve(APP_ROOT, "fixtures/host");
const BIN = resolve(APP_ROOT, "bin/zudo-composer.mjs");

/**
 * Resolve once the dev server announces where it is listening. The stream is
 * drained rather than ended: closing the child's stdout would kill it before
 * the signal under test ever arrives.
 */
function firstLocalUrl(child: ChildProcess): Promise<string> {
  return new Promise((settle, fail) => {
    let output = "";
    const read = (chunk: unknown) => {
      output += String(chunk);
      const url = /http:\/\/localhost:\d+/.exec(output)?.[0];
      if (!url) return;
      child.stdout!.off("data", read);
      child.stdout!.resume();
      settle(url);
    };
    child.stdout!.on("data", read);
    child.stderr!.resume();
    child.once("exit", () => fail(new Error(`dev server exited before listening:\n${output}`)));
  });
}

function portIsFree(port: number): Promise<boolean> {
  return new Promise((settle) => {
    const probe = createServer();
    probe.once("error", () => settle(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => settle(true)));
  });
}

let host: string;

beforeAll(async () => {
  host = realpathSync(await mkdtemp(join(tmpdir(), "zudo-composer-dev-server-")));
  await writeFile(join(host, "zudo-composer.config.ts"), 'const config = { pack: "@acme/themeset/composer-pack" };\nexport default config;\n');
});

afterAll(async () => {
  await rm(host, { recursive: true, force: true });
});

describe("resolveFsAllow", () => {
  it("allows both roots, so an installed package outside the host root stays readable", () => {
    const allow = resolveFsAllow(host);
    expect(allow).toContain(host);
    expect(allow).toContain(APP_ROOT);
  });

  it("lists each root's realpath as well, because pnpm reaches the package through a symlink", () => {
    const allow = resolveFsAllow(FIXTURE_HOST);
    expect(allow).toContain(realpathSync(FIXTURE_HOST));
    expect(allow).toContain(realpathSync(APP_ROOT));
    expect(new Set(allow).size).toBe(allow.length);
  });
});

describe("resolvePublicDir", () => {
  it("is the parent of the published-media directory", () => {
    expect(resolvePublicDir("/host", "/host/public/uploaded-media")).toBe("/host/public");
  });

  it("refuses a published-media directory sitting directly at the host root", () => {
    expect(() => resolvePublicDir("/host", "/host/uploaded-media")).toThrow(/must sit inside a static directory/);
  });
});

describe("loadHostConfig", () => {
  it("evaluates a TypeScript host config through Vite and resolves every path beneath the host", async () => {
    const config = await loadHostConfig(host);
    expect(config.settings.pack).toBe("@acme/themeset/composer-pack");
    expect(config.paths.compositions).toBe(join(host, "cms/compositions"));
    expect(config.configPath).toBe(join(host, "zudo-composer.config.ts"));
  });

  it("applies the per-setting environment override", async () => {
    const config = await loadHostConfig(host, { ZUDO_COMPOSER_DATA_DIR: "content-store" });
    expect(config.paths.compositions).toBe(join(host, "content-store/compositions"));
  });
});

describe("resolveComposerDevConfig", () => {
  // A real fixture host rather than the scratch directory above: the config now
  // resolves the component pack, and a pack is a package the host installs.
  it("roots Vite at the host while the package keeps ownership of the html shell", async () => {
    const { inlineConfig } = await resolveComposerDevConfig({ workspaceRoot: FIXTURE_HOST });
    expect(inlineConfig.root).toBe(FIXTURE_HOST);
    expect(inlineConfig.configFile).toBe(false);
    // Vite's own html middlewares would look for a `<host>/index.html`.
    expect(inlineConfig.appType).toBe("custom");
    expect(inlineConfig.publicDir).toBe(join(FIXTURE_HOST, "public"));
    const pack = resolveComponentPack(FIXTURE_HOST, "@zudo-sg/ui/composer-pack");
    expect(inlineConfig.optimizeDeps?.exclude).toEqual([pack.packageName, ...OPTIMIZE_DEPS_EXCLUDE]);
    expect(inlineConfig.optimizeDeps?.entries).toEqual([resolve(APP_ROOT, APP_ENTRY_MODULE)]);
    // The pack's own directory is allowed too: it is outside the host root.
    expect(inlineConfig.server?.fs?.allow).toEqual([...resolveFsAllow(FIXTURE_HOST), pack.packageRoot]);
    const names = inlineConfig.plugins?.flat().map((plugin) => (plugin as { name?: string } | undefined)?.name);
    expect(names).toContain("zudo-composer-app-html");
    expect(names).toContain("zudo-component-pack");
    expect(names).toContain("zudo-composer-host-styles");
  });

  it("refuses a host whose configured pack cannot be resolved", async () => {
    await expect(resolveComposerDevConfig({ workspaceRoot: host })).rejects.toThrow(
      /^Component pack "@acme\/themeset\/composer-pack" could not be resolved from /,
    );
  });
});

describe("the bin, run from a host project", () => {
  let child: ChildProcess | undefined;

  afterEach(() => {
    if (child?.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    child = undefined;
  });

  // A real child process rather than an in-process server: the port release and
  // the signal re-raise are properties of the process, not of the Vite object.
  it("serves the package's shell with a package-absolute entry, then releases the port on SIGINT", async () => {
    // Port 0: the OS picks a free port, so this never contends for one.
    child = spawn(process.execPath, [BIN, "dev", "--port", "0"], { cwd: FIXTURE_HOST, stdio: ["ignore", "pipe", "pipe"] });
    const origin = await firstLocalUrl(child);

    const shell = await fetch(`${origin}/composer`, { headers: { accept: "text/html", connection: "close" } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    const entry = new RegExp(`src="(/@fs[^"]*${APP_ENTRY_MODULE})"`).exec(html)?.[1];
    expect(entry).toBeDefined();
    expect(html).not.toContain(`src="/${APP_ENTRY_MODULE}"`);

    // The `/@fs` id is the whole point: it has to be readable under fs.allow,
    // which Vite would otherwise scope to the host root alone.
    const module = await fetch(`${origin}${entry}`, { headers: { connection: "close" } });
    expect(module.status).toBe(200);
    expect(await module.text()).toContain("#app");

    child.kill("SIGINT");
    const [code, signal] = (await once(child, "exit")) as [number | null, string | null];
    // The shell's 128+n convention for death by SIGINT.
    expect({ code, signal }).toEqual({ code: 130, signal: null });
    await expect(portIsFree(Number(new URL(origin).port))).resolves.toBe(true);
  });
});
