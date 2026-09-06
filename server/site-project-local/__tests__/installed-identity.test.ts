import { chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixture, review } from "./release-fixture";
import { installedPackageDigest } from "../installed-identity";
import { createSiteProjectApiService } from "../../../src/site-project/api/service";
import { project } from "../../../src/site-project/compiler/__tests__/fixtures";
describe("installed provider tree attestation", () => {
  it("hashes stable paths/modes/bytes and detects runtime tampering", async () => {
    const { parent, dependencies } = await fixture(); const root = join(parent, "installed"); await mkdir(root); await mkdir(join(root, "src"));
    const runtime = join(root, "src", "runtime.js"); await writeFile(runtime, "export const value = 1;", { mode: 0o644 });
    const first = await installedPackageDigest(root); expect(await installedPackageDigest(root)).toBe(first);
    await writeFile(runtime, "export const value = 2;"); const changed = await installedPackageDigest(root); expect(changed).not.toBe(first);
    const before = await review(createSiteProjectApiService({ ...dependencies, toolchain: { ...dependencies.toolchain, installedProviderDigest: first } }), project());
    const after = await review(createSiteProjectApiService({ ...dependencies, toolchain: { ...dependencies.toolchain, installedProviderDigest: changed } }), project());
    expect(after.projectRevision).toBe(before.projectRevision); expect(after.buildId).not.toBe(before.buildId);
    await chmod(runtime, 0o755); expect(await installedPackageDigest(root)).not.toBe(changed);
    await symlink(runtime, join(root, "link.js")); await expect(installedPackageDigest(root)).rejects.toThrow(/link/);
  });
});
