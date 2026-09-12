import { chmod, copyFile, cp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixture, review } from "./release-fixture";
import { installedContractDigest, installedPackageDigest } from "../installed-identity";
import { createSiteProjectApiService } from "../../../src/site-project/api/service";
import { project } from "../../../src/site-project/compiler/__tests__/fixtures";
describe("installed pack tree attestation", () => {
  it("hashes stable paths/modes/bytes and detects runtime tampering", async () => {
    const { parent, dependencies } = await fixture(); const root = join(parent, "installed"); await mkdir(root); await mkdir(join(root, "src"));
    const runtime = join(root, "src", "runtime.js"); await writeFile(runtime, "export const value = 1;", { mode: 0o644 });
    const first = await installedPackageDigest(root); expect(await installedPackageDigest(root)).toBe(first);
    await writeFile(runtime, "export const value = 2;"); const changed = await installedPackageDigest(root); expect(changed).not.toBe(first);
    const before = await review(createSiteProjectApiService({ ...dependencies, toolchain: { ...dependencies.toolchain, installedPackDigest: first } }), project());
    const after = await review(createSiteProjectApiService({ ...dependencies, toolchain: { ...dependencies.toolchain, installedPackDigest: changed } }), project());
    expect(after.projectRevision).toBe(before.projectRevision); expect(after.buildId).not.toBe(before.buildId);
    // A package's own node_modules is never part of its published bytes, and
    // under pnpm it is a tree of links — so it is skipped, not refused.
    await mkdir(join(root, "node_modules")); await symlink(runtime, join(root, "node_modules", "dep.js"));
    expect(await installedPackageDigest(root)).toBe(changed);
    await chmod(runtime, 0o755); expect(await installedPackageDigest(root)).not.toBe(changed);
    await symlink(runtime, join(root, "link.js")); await expect(installedPackageDigest(root)).rejects.toThrow(/link/);
  });
});

describe("published contract attestation", () => {
  async function contract() {
    const { parent } = await fixture();
    const root = join(parent, "contract");
    await mkdir(join(root, "dist", "chunks"), { recursive: true });
    await writeFile(join(root, "package.json"), '{"name":"contract","version":"1.0.0"}\n');
    await writeFile(join(root, "dist", "index.js"), "export const value = 1;\n");
    await writeFile(join(root, "dist", "index.d.ts"), "export declare const value = 1;\n");
    await writeFile(join(root, "dist", "chunks", "runtime.js"), "export {};\n");
    return { root, parent, digest: () => installedContractDigest(root) };
  }

  it("matches the packed entry set despite checkout tooling, sources, documentation and root modes", async () => {
    const { root, parent, digest } = await contract();
    const initial = await digest();
    for (const file of ["README.md", ".npmrc", "tsconfig.json", "vitest.config.ts"]) await writeFile(join(root, file), "checkout only");
    await mkdir(join(root, "src"));
    await symlink(join(root, "dist", "index.js"), join(root, "src", "runtime.ts"));
    expect(await digest()).toBe(initial);

    const packed = join(parent, "packed");
    await mkdir(packed, { mode: 0o700 });
    await cp(join(root, "dist"), join(packed, "dist"), { recursive: true });
    await copyFile(join(root, "package.json"), join(packed, "package.json"));
    expect(await installedContractDigest(packed)).toBe(initial);
  });

  it.each(["dist/index.js", "dist/index.d.ts", "dist/chunks/runtime.js"])("detects changes to published input %s", async (entry) => {
    const { root, digest } = await contract();
    const initial = await digest();
    await writeFile(join(root, entry), "changed published bytes");
    expect(await digest()).not.toBe(initial);
  });

  it("includes new dist entries and modes, and refuses missing or linked selected entries", async () => {
    const { root, parent, digest } = await contract();
    const initial = await digest();
    const added = join(root, "dist", "extra.js");
    await writeFile(added, "export {};", { mode: 0o644 });
    const extended = await digest();
    expect(extended).not.toBe(initial);
    await chmod(added, 0o755);
    expect(await digest()).not.toBe(extended);
    await rm(added);
    await symlink(root, join(parent, "linked-contract"));
    await expect(installedContractDigest(join(parent, "linked-contract"))).rejects.toThrow(/link/);
    await symlink(join(root, "package.json"), added);
    await expect(digest()).rejects.toThrow(/link/);
    await rm(added);
    await rm(join(root, "dist"), { recursive: true });
    await expect(digest()).rejects.toThrow(/ENOENT/);
    await symlink(join(parent, "packed"), join(root, "dist"));
    await expect(digest()).rejects.toThrow(/link/);
  });

  it("matches pnpm 11.5.2's published manifest while retaining the component pack's raw bytes", async () => {
    const { root, digest } = await contract();
    const published = { name: "contract", version: "1.0.0", scripts: { build: "tsc -b", install: "node install.mjs" } };
    await writeFile(join(root, "package.json"), JSON.stringify({
      ...published, packageManager: "pnpm@11.5.2", pnpm: { overrides: {} },
      scripts: { ...published.scripts, prepare: "pnpm run build", prepublishOnly: "prepublish", prepack: "prepack", postpack: "postpack", publish: "publish", postpublish: "postpublish" },
    }, null, 2));
    const checkout = await digest(), pack = await installedPackageDigest(root);
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: published.scripts, version: published.version, name: published.name }));
    expect(await digest()).toBe(checkout);
    expect(await installedPackageDigest(root)).not.toBe(pack);
  });

  it.each([
    { name: "different" }, { version: "2.0.0" }, { exports: { ".": "./dist/other.js" } },
    { dependencies: { runtime: "^2.0.0" } }, { scripts: { install: "node install.mjs" } },
    { description: "Changed published metadata" },
  ])("attests published manifest changes %j", async (changed) => {
    const { root, digest } = await contract();
    const initial = await digest();
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "contract", version: "1.0.0", ...changed }));
    expect(await digest()).not.toBe(initial);
  });

  it.each(["exports", "imports"])("preserves resolution-significant condition order in %s", async (field) => {
    const { root, digest } = await contract();
    const manifest = { name: "contract", version: "1.0.0", [field]: { import: "./dist/index.js", default: "./dist/fallback.js" } };
    await writeFile(join(root, "package.json"), JSON.stringify(manifest));
    const initial = await digest();
    manifest[field] = { default: "./dist/fallback.js", import: "./dist/index.js" };
    await writeFile(join(root, "package.json"), JSON.stringify(manifest));
    expect(await digest()).not.toBe(initial);
  });

  it("rejects a missing, linked or invalid published manifest", async () => {
    const { root, digest } = await contract();
    const manifest = join(root, "package.json");
    await writeFile(manifest, "{broken");
    await expect(digest()).rejects.toThrow();
    await rm(manifest);
    await expect(digest()).rejects.toThrow(/ENOENT/);
    await symlink(join(root, "dist", "index.js"), manifest);
    await expect(digest()).rejects.toThrow(/link/);
  });
});
