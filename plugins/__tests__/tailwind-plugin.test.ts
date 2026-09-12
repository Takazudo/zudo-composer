// @vitest-environment node

import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { build, resolveConfig, type InlineConfig } from "vite";
import { HOST_STYLES_ID, hostStylesPlugin } from "../host-styles-plugin.mjs";
import tailwindPlugin from "../tailwind-plugin.mjs";
import { APP_ROOT } from "../roots.mjs";

let host: string;

async function writeHostFile(path: string, contents: string) {
  const file = resolve(host, path);
  await mkdir(resolve(file, ".."), { recursive: true });
  await writeFile(file, contents);
}

beforeEach(async () => {
  // A workspace fixture could resolve the root's dependency by walking up its
  // parents. This host has no Tailwind dependency or path back to the tool.
  host = realpathSync(await mkdtemp(join(tmpdir(), "zudo-tailwind-host-")));
  await writeHostFile("package.json", JSON.stringify({ name: "tailwind-test-host", type: "module", private: true }));
  await writeHostFile("index.html", '<script type="module" src="/main.js"></script>');
  await writeHostFile("main.js", `import ${JSON.stringify(HOST_STYLES_ID)};`);
  await writeHostFile("styles/base.css", '@import "./layers/tailwind.css";\n@import "host-palette";');
  await writeHostFile("components/banner.html", '<div class="block bg-shop-smoke"></div>');
  await writeHostFile("node_modules/host-palette/package.json", JSON.stringify({
    name: "host-palette", exports: { ".": { style: "./palette.css" } },
  }));
  await writeHostFile("node_modules/host-palette/palette.css", ".host-palette { --host-palette-ready: 1; }");
});

afterEach(async () => {
  await rm(host, { recursive: true, force: true });
});

function hostConfig(): InlineConfig {
  return {
    configFile: false,
    root: host,
    publicDir: false,
    logLevel: "silent",
    plugins: [
      hostStylesPlugin({ stylesPath: resolve(host, "styles/base.css"), styles: "styles/base.css", configPath: resolve(host, "zudo-composer.config.ts") }),
      tailwindPlugin(),
    ],
    build: { write: false, minify: false, cssMinify: false },
  };
}

async function outputCss() {
  const result = await build(hostConfig());
  if (!("output" in result)) throw new Error("Expected a single in-memory build output.");
  return result.output.flatMap((file) => file.type === "asset" && file.fileName.endsWith(".css") ? [String(file.source)] : []).join("\n");
}

describe("tool-supplied Tailwind stylesheet imports", () => {
  it.each(["", ".css"])("builds outside the repo without host Tailwind (subpath suffix %j)", async (suffix) => {
    const requireFromHost = createRequire(resolve(host, "package.json"));
    expect(() => requireFromHost.resolve("tailwindcss/preflight")).toThrow();
    await writeHostFile("styles/layers/tailwind.css", `
      @import "tailwindcss/preflight${suffix}";
      @import "tailwindcss/utilities${suffix}" source(none);
      @theme { --color-shop-smoke: #123456; }
      @source "../../components";
    `);

    const css = await outputCss();
    expect(css).toContain("box-sizing: border-box");
    expect(css).toContain(".block");
    expect(css).toContain("display: block");
    expect(css).toContain(".bg-shop-smoke");
    expect(css).toContain("background-color: var(--color-shop-smoke)");
    expect(css).toContain(".host-palette");
    expect(css).toContain("--host-palette-ready: 1");
    expect(css).not.toContain("@import");
  });

  it("fails with the specifier and tool root even if the host could resolve the typo", async () => {
    const specifier = "tailwindcss/utilties";
    await writeHostFile("styles/layers/tailwind.css", `@import "${specifier}";`);
    await writeHostFile("node_modules/tailwindcss/package.json", JSON.stringify({
      name: "tailwindcss", exports: { "./utilties": "./host.css" },
    }));
    await writeHostFile("node_modules/tailwindcss/host.css", ".wrong-tailwind { display: block; }");
    expect(createRequire(resolve(host, "package.json")).resolve(specifier)).toBe(resolve(host, "node_modules/tailwindcss/host.css"));

    await expect(outputCss()).rejects.toThrow(`"${specifier}" could not be resolved from tool root ${APP_ROOT}`);
  });

  it.each(["serve", "build"] as const)("resolves tool CSS and host JavaScript in %s mode", async (command) => {
    await writeHostFile("node_modules/tailwindcss/package.json", JSON.stringify({
      name: "tailwindcss", exports: { "./preflight": "./host.css", "./colors": "./colors.js" },
    }));
    await writeHostFile("node_modules/tailwindcss/host.css", ".wrong-tailwind { display: block; }");
    await writeHostFile("node_modules/tailwindcss/colors.js", "export default { hostColor: '#abcdef' };");
    const config = await resolveConfig(hostConfig(), command);
    const cssResolver = config.createResolver({ extensions: [".css"], mainFields: ["style"], conditions: ["style"] });
    const fromHost = resolve(host, "styles/base.css");

    await expect(cssResolver("tailwindcss/preflight", fromHost, true)).resolves.toBe(
      createRequire(resolve(APP_ROOT, "package.json")).resolve("tailwindcss/preflight"),
    );
    await expect(config.createResolver()("tailwindcss/colors", resolve(host, "main.js"))).resolves.toBe(
      resolve(host, "node_modules/tailwindcss/colors.js"),
    );
  });
});
