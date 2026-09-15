// Server-side validation and release identity both follow the CONFIGURED pack.
//
// The themeset fixture shares no component id with `@zudo-sg/ui`, which is what
// makes the first assertion a real proof rather than a tautology: a project
// authored against one pack cannot pass a server validating against the other.

import { createRequire } from "node:module";
import { cp, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { TrustedComponentPack } from "@zudo-composer/component-contract";
import type { CompositionRecord } from "../../../src/composer/library/types";
import { componentPack as themeset } from "@zudo-composer/fixture-themeset/composer-pack";
import { packageRootAbove, resolveComponentPack } from "../../../plugins/component-pack.mjs";
import { createLocalSiteProjectApiService, resolveLocalReleaseToolchain } from "../service";
import { readActivatedSiteRelease } from "../dev-reader";
import { validateReleaseToolchain } from "../../../src/site-project/api/validation";
import { project } from "../../../src/site-project/compiler/__tests__/fixtures";
import { call, fixture, review, roots, toolchain } from "./release-fixture";

const themesetHost = resolve("fixtures/themeset-host");
const themesetSpecifier = "@zudo-composer/fixture-themeset/composer-pack";
const pack = themeset as unknown as TrustedComponentPack;

describe("server-side validation follows the configured pack", () => {
  it("rejects a project whose components the configured pack does not have", async () => {
    const context = await fixture();
    const value = project();
    const service = createLocalSiteProjectApiService({
      pack,
      testRoot: context.testRoot,
      assetsStoreRoot: context.assetRoot,
      toolchain: { ...toolchain, componentPack: { packId: pack.manifest.packId, packVersion: pack.manifest.packVersion, contractVersion: pack.manifest.contractVersion } },
    });
    const mismatched = await service.handle({ protocolVersion: 2, operation: "plan", project: value, workingPrecondition: null, selection: [], expectedRevision: null, expectedActive: null });
    expect(mismatched).toMatchObject({ ok: false, error: { code: "validation", diagnostics: [{ code: "component-pack-mismatch" }] } });

    // Now let the project claim the configured pack, so the identity check
    // passes and the components themselves are what is judged. Every id the
    // fixture authored is unknown to the themeset, and the server says so.
    value.componentPack = { packId: pack.manifest.packId, packVersion: pack.manifest.packVersion, contractVersion: pack.manifest.contractVersion };
    const unknown = await service.handle({ protocolVersion: 2, operation: "plan", project: value, workingPrecondition: null, selection: [], expectedRevision: null, expectedActive: null });
    expect(unknown).toMatchObject({ ok: false, error: { code: "validation" } });
    expect((unknown as unknown as { error: { diagnostics: readonly { code: string; message: string }[] } }).error.diagnostics).toContainEqual(
      expect.objectContaining({ code: "component-pack-incompatible", message: 'Unknown component "leaf" — not in the manifest' }),
    );
    expect(pack.manifest.components.map(({ id }) => id)).toEqual(["themeset.panel", "themeset.note"]);
  });
});

describe("release toolchain identity", () => {
  it("attests the pack as a package — specifier, install spec, and resolved bytes", async () => {
    const identity = resolveComponentPack(themesetHost, themesetSpecifier);
    const resolved = await resolveLocalReleaseToolchain({ pack, packIdentity: identity, workspaceRoot: themesetHost });
    expect(validateReleaseToolchain(resolved)).toBe(true);
    expect(resolved).toMatchObject({
      componentPack: { packId: "@zudo-composer/fixture-themeset", packVersion: "1.0.0" },
      packSpecifier: themesetSpecifier,
      // How the host installed it, read off the host's own package.json.
      packSource: "workspace:*",
    });
    expect(resolved.compiler.startsWith("site-project-release/2:")).toBe(true);
    expect(resolved.installedPackDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(resolved.contractDigest).toMatch(/^[a-f0-9]{64}$/);
    // Digesting is deterministic, so a second call over the same install agrees.
    expect((await resolveLocalReleaseToolchain({ pack, packIdentity: identity, workspaceRoot: themesetHost })).installedPackDigest).toBe(resolved.installedPackDigest);
  });

  it("refuses to invent a toolchain without a resolved pack", async () => {
    await expect(resolveLocalReleaseToolchain({ workspaceRoot: themesetHost })).rejects.toThrow(/never falls back to a bundled provider pack/);
  });

  it("names a self-reference's install spec `self`", async () => {
    const selfHost = resolve("fixtures/self-host");
    const identity = resolveComponentPack(selfHost, "self-host/components");
    const { componentPack: selfPack } = (await import("../../../fixtures/self-host/components/pack")) as { componentPack: TrustedComponentPack };
    const resolved = await resolveLocalReleaseToolchain({ pack: selfPack, packIdentity: identity, workspaceRoot: selfHost });
    expect(resolved.packSource).toBe("self");
    expect(resolved.packSpecifier).toBe("self-host/components");
    expect(validateReleaseToolchain(resolved)).toBe(true);
  });
});

// The root-entry fixture: `self-host-root/pack` exports the package root
// itself, so `packIdentity.packageRoot === workspaceRoot` here the same way
// it does for `fixtures/self-host` above — but with nothing between the pack
// module and the host root. The pre-graph digest hashed `dirname(entryPath)`
// for that shape, which for this fixture is the whole host root: `cms/`,
// `.zudo-site-project/` and `dist-site/` writes would all have changed it.
// These specs prove the graph-identified digest is scoped to exactly the
// resolved source graph instead.
describe("host-self pack graph identity (root-entry fixture)", () => {
  const selfHostRootFixture = resolve("fixtures/self-host-root");

  async function loadSelfHostRootPack(): Promise<TrustedComponentPack> {
    const { componentPack } = (await import("../../../fixtures/self-host-root/pack.mjs")) as { componentPack: unknown };
    return componentPack as TrustedComponentPack;
  }

  /** A disposable copy with its own `node_modules/preact`, so a test can bump
   * that dependency's version without touching the repository's shared
   * install. Cleaned up by `release-fixture.ts`'s shared `afterEach`. */
  async function copySelfHostRoot(): Promise<string> {
    const parent = await realpath(await mkdtemp(join(tmpdir(), "self-host-root-")));
    roots.push(parent);
    const root = join(parent, "self-host-root");
    await cp(selfHostRootFixture, root, { recursive: true });
    const require = createRequire(join(selfHostRootFixture, "package.json"));
    for (const [name, subpath] of [["preact", "preact"], ["tailwindcss", "tailwindcss/preflight"]] as const) {
      const packageRoot = packageRootAbove(require.resolve(subpath));
      await cp(packageRoot, join(root, "node_modules", name), { recursive: true });
    }
    return root;
  }

  it("reproduces the root-entry shape and resolves a valid digest", async () => {
    const identity = resolveComponentPack(selfHostRootFixture, "self-host-root/pack");
    expect(identity.packageRoot).toBe(selfHostRootFixture);
    const selfPack = await loadSelfHostRootPack();
    const resolved = await resolveLocalReleaseToolchain({ pack: selfPack, packIdentity: identity, workspaceRoot: selfHostRootFixture });
    expect(resolved.packSource).toBe("self");
    expect(resolved.packSpecifier).toBe("self-host-root/pack");
    expect(validateReleaseToolchain(resolved)).toBe(true);
  });

  it("stays unchanged after writing into cms/, .zudo-site-project/ and dist-site/", async () => {
    const selfPack = await loadSelfHostRootPack();
    const root = await copySelfHostRoot();
    const identity = resolveComponentPack(root, "self-host-root/pack");
    const digestOf = async () => (await resolveLocalReleaseToolchain({ pack: selfPack, packIdentity: identity, workspaceRoot: root })).installedPackDigest;
    const initial = await digestOf();

    await mkdir(join(root, "cms", "content"), { recursive: true });
    await writeFile(join(root, "cms", "content", "article.json"), "{}");
    // Gitignored anywhere in the repo, so the checked-in fixture has none —
    // created here, the way a real host's own release/build state would be.
    await mkdir(join(root, ".zudo-site-project", "builds"), { recursive: true });
    await writeFile(join(root, ".zudo-site-project", "builds", "example.json"), "{}");
    await mkdir(join(root, "dist-site"), { recursive: true });
    await writeFile(join(root, "dist-site", "index.html"), "<html></html>");

    expect(await digestOf()).toBe(initial);
  });

  it.each(["pack.mjs", "lib/banner.mjs", "lib/banner.css"])("changes after editing %s", async (relative) => {
    const selfPack = await loadSelfHostRootPack();
    const root = await copySelfHostRoot();
    const identity = resolveComponentPack(root, "self-host-root/pack");
    const digestOf = async () => (await resolveLocalReleaseToolchain({ pack: selfPack, packIdentity: identity, workspaceRoot: root })).installedPackDigest;
    const initial = await digestOf();
    const target = join(root, relative);
    await writeFile(target, `${await readFile(target, "utf8")}\n/* edited for the test */\n`);
    expect(await digestOf()).not.toBe(initial);
  });

  it("changes after editing the host's configured stylesheet root, even though the pack never imports it", async () => {
    const selfPack = await loadSelfHostRootPack();
    const root = await copySelfHostRoot();
    const identity = resolveComponentPack(root, "self-host-root/pack");
    // No `stylesPath` override: this also proves the default `styles`
    // setting ("styles/base.css") is what a caller gets without one.
    const digestOf = async () => (await resolveLocalReleaseToolchain({ pack: selfPack, packIdentity: identity, workspaceRoot: root })).installedPackDigest;
    const initial = await digestOf();
    const stylesPath = join(root, "styles", "base.css");
    await writeFile(stylesPath, `${await readFile(stylesPath, "utf8")}\n.extra {}\n`);
    expect(await digestOf()).not.toBe(initial);
  });

  it("changes after bumping the resolved bare dependency's version", async () => {
    const selfPack = await loadSelfHostRootPack();
    const root = await copySelfHostRoot();
    const identity = resolveComponentPack(root, "self-host-root/pack");
    const digestOf = async () => (await resolveLocalReleaseToolchain({ pack: selfPack, packIdentity: identity, workspaceRoot: root })).installedPackDigest;
    const initial = await digestOf();
    const preactManifest = join(root, "node_modules", "preact", "package.json");
    const manifest = JSON.parse(await readFile(preactManifest, "utf8")) as Record<string, unknown>;
    await writeFile(preactManifest, JSON.stringify({ ...manifest, version: "10.99.99" }));
    expect(await digestOf()).not.toBe(initial);
  });

  it("shows no drift across plan/apply/build/activate and reopen, including the stored-vs-fresh toolchain comparison", async () => {
    const selfPack = await loadSelfHostRootPack();
    const identity = resolveComponentPack(selfHostRootFixture, "self-host-root/pack");
    const context = await fixture();
    const composition: CompositionRecord = {
      id: "landing",
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z",
      document: {
        schemaVersion: 2,
        id: "landing",
        name: "landing",
        root: [{ id: "landing-banner", componentId: "self-host-root.banner", componentVersion: 1, props: { headline: "Hello" }, slots: {} }],
      },
    };
    const value = project({ compositions: [composition], mappings: [] });
    value.componentPack = { contractVersion: 2, packId: "self-host-root", packVersion: "1.0.0" };
    const options = { pack: selfPack, packIdentity: identity, workspaceRoot: selfHostRootFixture, testRoot: context.testRoot, assetsStoreRoot: context.assetRoot };
    const service = createLocalSiteProjectApiService(options);
    const plan = await review(service, value);
    const applied = await call<{ buildId: string }>(service, "apply", { plan });
    const completed = await call<{ identity: { projectId: string; revision: string; buildId: string } }>(service, "build", { projectId: value.id, buildId: applied.buildId });
    await call(service, "activate", { ...completed.identity, expectedActive: null });

    const reopened = await readActivatedSiteRelease(options);
    expect(reopened?.release.identity).toEqual(completed.identity);
  });
});
