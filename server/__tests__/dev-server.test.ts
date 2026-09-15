import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { build } from "vite";
import { APP_ROOT, resolvePublicDir } from "../../plugins/roots.mjs";
import { APP_ENTRY_MODULE } from "../../plugins/composer-app-html.mjs";
import { OPTIMIZE_DEPS_EXCLUDE, loadHostConfig, resolveComposerDevConfig } from "../dev-server.mjs";
import { resolveImageEditorAliases } from "../../plugins/image-editor-aliases.mjs";
import { resolveFsAllow } from "../../plugins/roots.mjs";
import { resolveComponentPack } from "../../plugins/component-pack.mjs";

const FIXTURE_HOST = resolve(APP_ROOT, "fixtures/host");
const BIN = resolve(APP_ROOT, "bin/zudo-composer.mjs");

/**
 * Resolve once the dev server announces where it is listening. The stream is
 * drained rather than ended: closing the child's stdout would kill it before
 * the signal under test ever arrives.
 */
// eslint-disable-next-line no-control-regex
const ANSI = /\u001B\[[0-9;]*[A-Za-z]/g;
const stripAnsi = (value: string) => value.replace(ANSI, "");

function firstLocalUrl(child: ChildProcess, waitMs = 45_000): Promise<string> {
  return new Promise((settle, fail) => {
    let output = "";
    let errors = "";
    // Capture stderr rather than draining it: without this a child that boots but never
    // reaches "Local: http://…" fails as a bare timeout with no cause attached, which is
    // indistinguishable from the suite simply being slow.
    const readErr = (chunk: unknown) => {
      errors += String(chunk);
    };
    const done = (run: () => void) => {
      clearTimeout(timer);
      child.stdout!.off("data", read);
      child.stderr!.off("data", readErr);
      run();
    };
    const detail = () => `\n--- stdout ---\n${output}\n--- stderr ---\n${errors}`;
    const timer = setTimeout(
      () => done(() => fail(new Error(`dev server never advertised a local URL in ${waitMs}ms:${detail()}`))),
      waitMs,
    );
    const read = (chunk: unknown) => {
      output += String(chunk);
      // Vite styles the port, and CI forces color even when stdout is a pipe, so the raw
      // text reads `localhost:<ESC>[1m46801<ESC>[22m`. Match against a stripped copy or
      // the URL is invisible on exactly the machines that matter.
      const url = /http:\/\/localhost:\d+/.exec(stripAnsi(output))?.[0];
      if (!url) return;
      done(() => {
        child.stdout!.resume();
        settle(url);
      });
    };
    child.stdout!.on("data", read);
    child.stderr!.on("data", readErr);
    child.once("exit", (code, signal) =>
      done(() => fail(new Error(`dev server exited before listening (code=${code} signal=${signal}):${detail()}`))),
    );
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
  it("is the parent of the published-assets directory", () => {
    expect(resolvePublicDir("/host", "/host/public/uploaded-assets")).toBe("/host/public");
  });

  it("refuses a published-assets directory sitting directly at the host root", () => {
    expect(() => resolvePublicDir("/host", "/host/uploaded-assets")).toThrow(/must sit inside a static directory/);
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
    expect(inlineConfig.resolve?.alias).toEqual(resolveImageEditorAliases());
    expect(inlineConfig.resolve?.dedupe).toEqual(["preact"]);
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

describe("the host Preact peer", () => {
  it("shares one runtime and every public subpath across an external app graph and a host pack", async () => {
    const directory = realpathSync(await mkdtemp(join(tmpdir(), "zudo-composer-preact-peer-")));
    try {
      const hostRoot = join(directory, "host");
      const toolRoot = join(directory, "tool");
      const packRoot = join(directory, "pack");
      const hostPreact = join(hostRoot, "node_modules/preact");
      const appEntry = join(toolRoot, "entry.js");
      const packEntry = join(packRoot, "pack.js");
      const installedPreact = realpathSync(join(APP_ROOT, "node_modules/preact"));
      const preactPackage = JSON.parse(await readFile(join(installedPreact, "package.json"), "utf8")) as {
        exports: Record<string, string | { browser?: string }>;
      };
      await Promise.all([
        mkdir(join(hostRoot, "node_modules"), { recursive: true }),
        mkdir(toolRoot),
        mkdir(join(packRoot, "node_modules"), { recursive: true }),
      ]);
      // These are two PHYSICAL copies, not two symlinks to one workspace
      // install. Without dedupe the app and pack really do load different
      // Preact options/hooks singletons, even though their versions match.
      await cp(installedPreact, hostPreact, { recursive: true });
      await Promise.all([
        symlink(join(APP_ROOT, "node_modules"), join(toolRoot, "node_modules"), "dir"),
        symlink(hostPreact, join(packRoot, "node_modules/preact"), "dir"),
        symlink(packRoot, join(hostRoot, "node_modules/peer-fixture-pack"), "dir"),
        writeFile(join(hostRoot, "package.json"), JSON.stringify({ name: "peer-fixture-host", type: "module", dependencies: { preact: "^10.29.8" } })),
        writeFile(join(toolRoot, "package.json"), JSON.stringify({ name: "peer-fixture-tool", type: "module" })),
        writeFile(join(packRoot, "package.json"), JSON.stringify({ name: "peer-fixture-pack", type: "module", exports: { "./composer-pack": "./pack.js" }, peerDependencies: { preact: "^10.29.8" } })),
        writeFile(join(hostRoot, "zudo-composer.config.ts"), 'export default { pack: "peer-fixture-pack/composer-pack" };\n'),
        cp(join(APP_ROOT, "fixtures/self-host/components/components.tsx"), join(packRoot, "components.tsx")),
        writeFile(packEntry, `
          import { h } from "preact";
          import { useContext, useState } from "preact/hooks";
          export { options } from "preact";
          export { useState } from "preact/hooks";
          export { Banner } from "./components.tsx";
          export function HostConsumer({ context }) {
            const [suffix] = useState("hooks");
            return h("span", null, useContext(context) + ": " + suffix);
          }
        `),
        // Production virtual modules also re-export a host pack by absolute
        // path, crossing from the tool's graph into host-owned source.
        writeFile(appEntry, `
          import { createContext, h, options } from "preact";
          import { useState } from "preact/hooks";
          import { renderToString } from "preact-render-to-string";
          import { Banner, HostConsumer, options as packOptions, useState as packUseState } from ${JSON.stringify(packEntry)};
          const context = createContext("unprovided default");
          export const sharedRuntime = options === packOptions && useState === packUseState;
          export const markup = renderToString(h(context.Provider, { value: "host peer" }, h(HostConsumer, { context })));
          export const banner = renderToString(h(Banner, { headline: "Hook fixture" }));
        `),
      ]);
      expect(createRequire(appEntry).resolve("preact")).not.toBe(createRequire(packEntry).resolve("preact"));
      const { inlineConfig } = await resolveComposerDevConfig({ workspaceRoot: hostRoot });
      // A tiny client bundle exercises Vite's real resolver and the actual
      // Preact runtime without listening on a port or starting a browser.
      const result = await build({
        configFile: false,
        root: hostRoot,
        logLevel: "silent",
        resolve: inlineConfig.resolve,
        oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
        plugins: [{
          name: "preact-peer-resolution-proof",
          async buildStart() {
            for (const [subpath, target] of Object.entries(preactPackage.exports)) {
              const specifier = subpath === "." ? "preact" : `preact${subpath.slice(1)}`;
              const appResolution = await this.resolve(specifier, appEntry);
              const packResolution = await this.resolve(specifier, packEntry);
              expect(appResolution?.id, specifier).toBe(packResolution?.id);
              expect(appResolution?.id.startsWith(`${hostPreact}/`), specifier).toBe(true);
              if (typeof target !== "string" && target.browser) {
                expect(appResolution?.id, specifier).toBe(resolve(hostPreact, target.browser));
              }
            }
            // A real private file must stay behind Preact's export boundary.
            await expect(this.resolve("preact/src/index.js", appEntry)).rejects.toThrow(/preact\/src\/index\.js/);
          },
        }],
        build: {
          write: false,
          minify: false,
          lib: { entry: appEntry, formats: ["cjs"], fileName: "peer-proof" },
        },
      });
      const outputs = Array.isArray(result) ? result : [result];
      const chunk = outputs.flatMap((output) => "output" in output ? output.output : []).find((output) => output.type === "chunk");
      expect(chunk).toBeDefined();
      const rendered: { sharedRuntime?: boolean; markup?: string; banner?: string } = {};
      runInNewContext(chunk!.code, { exports: rendered });
      expect(rendered.sharedRuntime).toBe(true);
      expect(rendered.markup).toBe("<span>host peer: hooks</span>");
      expect(rendered.banner).toMatch(/^<h1 id="[^"]+" class="self-host-banner">Hook fixture<\/h1>$/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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
