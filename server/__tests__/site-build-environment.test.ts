import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { build, type InlineConfig } from "vite";
import { APP_ROOT, SITE_BUILD_ENTRY, appModuleId } from "../../plugins/roots.mjs";
import { runSiteBuild } from "../site-build/run.mjs";

let directory: string;
let host: string;

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), "site-build-environment-")));
  // Put a forbidden source-path segment in the real TSX filename on every
  // platform, so development JSX must also fail the unchanged artifact scan.
  host = join(directory, "home", "host");
  await mkdir(host, { recursive: true });
  const demo = join(APP_ROOT, "packages/demo-webshop");
  for (const name of ["package.json", "components", "styles", "site-project.json", "cms/assets"]) {
    await cp(join(demo, name), join(host, name), { recursive: true });
  }
  await mkdir(join(host, "node_modules/@zudo-composer"), { recursive: true });
  await symlink(APP_ROOT, join(host, "node_modules/zudo-composer"), "dir");
  await symlink(join(APP_ROOT, "node_modules/preact"), join(host, "node_modules/preact"), "dir");
  await symlink(join(APP_ROOT, "node_modules/@zudo-composer/component-contract"), join(host, "node_modules/@zudo-composer/component-contract"), "dir");
  await writeFile(join(host, "zudo-composer.config.ts"), `
    import { writeFileSync } from "node:fs";
    writeFileSync(new URL("./config-node-env.json", import.meta.url), JSON.stringify(process.env.NODE_ENV));
    export default { pack: "demo-webshop/components" };
  `);
  await writeFile(join(host, "visitor.tsx"), `
    import { render } from "preact";
    const label: string = import.meta.env.PROD ? "production-jsx-proof" : "development-jsx-proof";
    render(<main data-env={import.meta.env.VITE_ENV_PROBE}>{label}</main>, document.getElementById("app")!);
  `);
  vi.stubEnv("VITE_USER_NODE_ENV", undefined);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

function tinyBuild() {
  const observed: { beforeBuildNodeEnv?: string; isProduction?: boolean; mode?: string } = {};
  return {
    observed,
    build: async (config: InlineConfig) => {
      observed.beforeBuildNodeEnv = process.env.NODE_ENV;
      return build({
        ...config,
        logLevel: "silent",
        plugins: [...config.plugins ?? [], {
          name: "bounded-site-environment-proof",
          // Keep the actual shell, config, Preact transforms and verifier;
          // just point the shell at a tiny real TSX file for this bounded gate.
          transformIndexHtml: { order: "pre", handler(html) {
            return html.replace(`src=${JSON.stringify(appModuleId(SITE_BUILD_ENTRY))}`, 'src="/visitor.tsx"');
          } },
          configResolved(resolved) {
            observed.isProduction = resolved.isProduction;
            observed.mode = resolved.mode;
          },
        }],
      });
    },
  };
}

async function builtJavaScript() {
  const assets = join(host, "dist-site/assets");
  const scripts = (await readdir(assets)).filter((name) => name.endsWith(".js"));
  expect(scripts.length).toBeGreaterThan(0);
  return (await Promise.all(scripts.map((name) => readFile(join(assets, name), "utf8")))).join("\n");
}

describe("static build environment", () => {
  it.each([
    { label: "unset", nodeEnv: undefined, envNodeEnv: undefined, production: true },
    { label: "empty", nodeEnv: "", envNodeEnv: undefined, production: true },
    { label: "explicit production overrides the host env file", nodeEnv: "production", envNodeEnv: "development", production: true },
    { label: "explicit development", nodeEnv: "development", envNodeEnv: undefined, production: false },
    { label: "host env file selects development", nodeEnv: undefined, envNodeEnv: "development", production: false },
  ])("preserves Vite environment semantics: $label", async ({ nodeEnv, envNodeEnv, production }) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    await writeFile(join(host, ".env.production"), `VITE_ENV_PROBE=host-env-marker\n${envNodeEnv ? `NODE_ENV=${envNodeEnv}\n` : ""}`);
    const proof = tinyBuild();
    const result = runSiteBuild({ workspaceRoot: host }, { build: proof.build });
    if (production) {
      await expect(result).resolves.toMatchObject({ projectId: "demo-webshop" });
    } else {
      await expect(result).rejects.toThrow("Site artifact leaked forbidden marker /home/");
    }
    expect(JSON.parse(await readFile(join(host, "config-node-env.json"), "utf8"))).toBe(nodeEnv || "production");
    expect(proof.observed).toEqual({ beforeBuildNodeEnv: nodeEnv, isProduction: production, mode: "production" });
    const code = await builtJavaScript();
    expect(code).toContain("host-env-marker");
    expect(code).toContain(production ? "production-jsx-proof" : "development-jsx-proof");
    if (production) {
      expect(code).not.toContain("fileName");
      expect(code).not.toContain("/home/");
      expect(code).not.toContain("visitor.tsx");
    } else {
      expect(code).toContain("fileName");
      expect(code).toContain("visitor.tsx");
    }
  });

  it("retains an environment selected explicitly by the host config", async () => {
    vi.stubEnv("NODE_ENV", undefined);
    const configPath = join(host, "zudo-composer.config.ts");
    await writeFile(configPath, `process.env.NODE_ENV = "development";\n${await readFile(configPath, "utf8")}`);
    const proof = tinyBuild();
    await expect(runSiteBuild({ workspaceRoot: host }, { build: proof.build })).rejects.toThrow("Site artifact leaked forbidden marker /home/");
    expect(proof.observed).toEqual({ beforeBuildNodeEnv: "development", isProduction: false, mode: "production" });
  });

  it.each([undefined, "", "development"])("restores the caller's NODE_ENV=%s when config evaluation fails", async (nodeEnv) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    await writeFile(join(host, "zudo-composer.config.ts"), 'throw new Error("Config evaluation failed");');
    const build = vi.fn();
    await expect(runSiteBuild({ workspaceRoot: host }, { build })).rejects.toThrow("Config evaluation failed");
    expect(build).not.toHaveBeenCalled();
    expect(process.env.NODE_ENV).toBe(nodeEnv);
  });
});
