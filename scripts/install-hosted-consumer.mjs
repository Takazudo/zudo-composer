// @ts-check
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const sha = process.argv[2];
assert.match(sha ?? "", /^[a-f0-9]{40}$/, "Provide a reachable full Composer package-output Git SHA");
const root = resolve(import.meta.dirname, "..");
const destination = process.argv[3] ? resolve(process.argv[3]) : await mkdtemp(join(tmpdir(), "composer-hosted-consumer-"));
await mkdir(destination, { recursive: true });
await cp(join(root, "fixtures/hosted-content-consumer"), destination, { recursive: true, filter: path => !path.split(/[\\/]/).includes("node_modules") && !path.split(/[\\/]/).includes("dist") });
const manifest = {
  name: "composer-hosted-public-consumer", version: "0.0.0", private: true, type: "module", packageManager: "pnpm@11.5.2",
  dependencies: {
    "zudo-composer": `git+https://github.com/Takazudo/zudo-composer.git#${sha}`,
    "@zudo-composer/component-contract": "git+https://github.com/Takazudo/zudo-composer.git#c0b452da075b66757c60bd0d721a47062d4354d0",
    preact: "10.29.8", "@takazudo/zfb": "4.3.1", "@takazudo/zfb-runtime": "4.3.1",
    "@takazudo/zudo-sg": "0.5.0", "@takazudo/zdtp": "0.8.6", "@takazudo/zudo-doc": "6.0.0",
  },
  devDependencies: { esbuild: "0.28.2", "@playwright/test": "1.62.1", tsx: "4.23.12", typescript: "6.0.3", miniflare: "5.20261006.1-alpha" },
};
await writeFile(join(destination, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
await writeFile(join(destination, "pnpm-workspace.yaml"), "packages: []\nautoInstallPeers: false\nstrictPeerDependencies: true\nallowBuilds:\n  '@zudo-composer/component-contract': true\n  esbuild: true\n  workerd: true\n");
execFileSync("corepack", ["pnpm", "install"], { cwd: destination, stdio: "inherit" });
await writeFile(join(destination, "installed-sha.json"), JSON.stringify({ toolSha: sha, contractSha: "c0b452da075b66757c60bd0d721a47062d4354d0", node: process.version, manifest: JSON.parse(await readFile(join(destination, "package.json"), "utf8")) }, null, 2) + "\n");
console.log(JSON.stringify({ consumer: destination, toolSha: sha }));
