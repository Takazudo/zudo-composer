import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { UI_PACK } from "../../../scripts/ui-pack-identity.mjs";

describe("owned UI pack dependency", () => {
  it("consumes the pack from the workspace and one workspace component contract", () => {
    const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      peerDependencies: Record<string, string>;
    };
    expect(pkg.dependencies[UI_PACK.packageName]).toBeUndefined();
    expect(pkg.peerDependencies[UI_PACK.packageName]).toBeUndefined();
    expect(pkg.devDependencies[UI_PACK.packageName]).toBe(UI_PACK.workspaceSpec);
    // The contract is consumed from the workspace here but published as a peer, so it
    // must never appear in `dependencies` — a `workspace:*` spec there would ship.
    expect(pkg.dependencies["@zudo-composer/component-contract"]).toBeUndefined();
    expect(pkg.devDependencies["@zudo-composer/component-contract"]).toBe("workspace:*");
    expect(pkg.peerDependencies["@zudo-composer/component-contract"]).toBe("^1.0.0");
    // The host supplies the runtime shared by the tool and its component pack.
    // Keeping a tool-owned dependency would allow a second physical copy.
    expect(pkg.dependencies.preact).toBeUndefined();
    expect(pkg.peerDependencies.preact).toBe("^10.29.8");
    expect(pkg.devDependencies.preact).toBe(pkg.peerDependencies.preact);
  });

  it("links the workspace package and keeps no retired provider in the lock", () => {
    const lock = readFileSync(resolve("pnpm-lock.yaml"), "utf8");
    expect(lock).toContain(`'${UI_PACK.packageName}':\n        specifier: ${UI_PACK.workspaceSpec}\n        version: link:${UI_PACK.sourcePath}\n`);
    expect(lock).not.toMatch(/zudo-sg/);
    expect(realpathSync(resolve("node_modules", UI_PACK.packageName))).toBe(realpathSync(resolve(UI_PACK.sourcePath)));
  });

  it("records the external handoff as one exact root Git spec on the package-only branch", () => {
    const handoff = JSON.parse(readFileSync(resolve("ui-handoff.json"), "utf8")) as Record<string, string>;
    expect(handoff).toEqual({
      packageName: UI_PACK.packageName,
      sourcePath: UI_PACK.sourcePath,
      packageBranch: "package/ui-v1",
      packageCommit: UI_PACK.packageCommit,
      rootGitSpec: UI_PACK.rootGitSpec,
    });
    expect(handoff.rootGitSpec).not.toMatch(/&path:|(?:^|:)(?:workspace|file|link|path):/);
  });
});
