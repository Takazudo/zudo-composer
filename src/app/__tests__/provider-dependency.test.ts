import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { UI_PACK } from "../../../scripts/ui-pack-identity.mjs";

const SHA = UI_PACK.provenanceCommit;
const TREE = UI_PACK.provenanceTree;
const SPEC = UI_PACK.dependencySpec;
const TARBALL = UI_PACK.lock.tarballUrl;

function section(source: string, heading: string, nextHeading?: string): string {
  const start = source.indexOf(`${heading}:\n`);
  if (start < 0) throw new Error(`Missing lockfile section: ${heading}`);
  const end = nextHeading ? source.indexOf(`\n${nextHeading}:\n`, start) : source.length;
  return source.slice(start, end < 0 ? source.length : end);
}

function indentedBlock(source: string, key: string, indent: number): string {
  const prefix = `${" ".repeat(indent)}${key}:\n`;
  const start = source.indexOf(prefix);
  if (start < 0) throw new Error(`Missing lockfile block: ${key}`);
  const tail = source.slice(start + prefix.length);
  const next = tail.search(new RegExp(`^ {${indent}}\\S.*:\\n`, "m"));
  return source.slice(start, next < 0 ? source.length : start + prefix.length + next);
}

describe("immutable UI provider dependency", () => {
  it("pins the advertised Git spec and one workspace component contract", () => {
    const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      peerDependencies: Record<string, string>;
    };
    expect(pkg.dependencies[UI_PACK.packageName]).toBeUndefined();
    expect(pkg.devDependencies[UI_PACK.packageName]).toBe(SPEC);
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
    expect(pkg.devDependencies[UI_PACK.packageName]).not.toMatch(/(?:^|:)(?:file|link|path):|\.\.|packages\/ui/);
  });

  it("normalizes the lock to the exact full commit without local path leakage", () => {
    const lock = readFileSync(resolve("pnpm-lock.yaml"), "utf8");
    const rootImporter = indentedBlock(section(lock, "importers", "packages"), ".", 2);
    const importer = indentedBlock(rootImporter, `'${UI_PACK.packageName}'`, 6);
    const packageBlock = indentedBlock(section(lock, "packages", "snapshots"), `'${UI_PACK.packageName}@${TARBALL}'`, 2);
    const snapshotSection = section(lock, "snapshots");
    const snapshotKey = snapshotSection.match(new RegExp(`^  ('${UI_PACK.packageName}@${TARBALL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^']*'):\\n`, "m"))?.[1];
    expect(snapshotKey).toBeTruthy();
    const snapshot = indentedBlock(snapshotSection, snapshotKey!, 2);

    expect(importer).toContain(`specifier: ${SPEC}`);
    expect(importer).toContain(`version: ${TARBALL}${UI_PACK.lock.peerResolutionSuffix}`);
    // pnpm records an `integrity:` field between `gitHosted:` and `tarball:` when it
    // re-resolves a Git dependency, so assert the two load-bearing parts separately
    // rather than matching one contiguous string.
    expect(packageBlock).toMatch(/resolution: \{gitHosted: true,/);
    expect(packageBlock).toContain(`tarball: ${TARBALL}}`);
    expect(packageBlock).toContain(`version: ${UI_PACK.installedVersion}`);
    expect(snapshot).toContain("'@zudo-composer/component-contract': link:packages/component-contract");
    for (const block of [importer, packageBlock, snapshot]) {
      expect(block).not.toMatch(/(?:workspace|file|path|sibling):|\.\.\/|packages\/ui/);
    }
    expect(snapshot.match(/link:packages\/component-contract/g)).toHaveLength(1);
  });

  it("records the independently verified immutable provider tree", () => {
    // The commit -> tree mapping was verified against the zudo-sg checkout
    // (`6b0826c` verifies as tree `1c3cbfd…`, see epic #686); this locks the
    // central module's pair against silent drift.
    expect({ commit: SHA, tree: TREE }).toEqual({
      commit: UI_PACK.provenanceCommit,
      tree: UI_PACK.provenanceTree,
    });
  });
});
