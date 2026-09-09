// Server-side validation and release identity both follow the CONFIGURED pack.
//
// The themeset fixture shares no component id with `@zudo-sg/ui`, which is what
// makes the first assertion a real proof rather than a tautology: a project
// authored against one pack cannot pass a server validating against the other.

import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { TrustedComponentPack } from "@zudo-composer/component-contract";
import { componentPack as themeset } from "@zudo-composer/fixture-themeset/composer-pack";
import { resolveComponentPack } from "../../../plugins/component-pack.mjs";
import { createLocalSiteProjectApiService, resolveLocalReleaseToolchain } from "../service";
import { validateReleaseToolchain } from "../../../src/site-project/api/validation";
import { project } from "../../../src/site-project/compiler/__tests__/fixtures";
import { fixture, toolchain } from "./release-fixture";

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
