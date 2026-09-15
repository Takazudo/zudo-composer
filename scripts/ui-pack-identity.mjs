// @ts-check

// Single source of truth for the Composer UI component pack's identity (#699,
// flipped to the owned package by #701, from epic #686's "Decision (from C0)"
// table). Every boundary gate, unit test and browser proof that asserts "this
// exact package, this exact handoff" reads from here instead of repeating the
// literals.
//
// Imported by scripts, unit tests and tests/browser only — never by shipped
// code, since `scripts/` is excluded from the published tarball.

import { readFileSync } from "node:fs";

/** @type {{packageName: string, sourcePath: string, packageBranch: string, packageCommit: string, rootGitSpec: string}} */
const handoff = JSON.parse(readFileSync(new URL("../ui-handoff.json", import.meta.url), "utf8"));

// The zudo-sg package commit the twelve components were ported from.
const provenanceCommit = "6b0826cdaa14d9888e58c795ee015f70e2c5cbdf";
const appProvenanceCommit = "f1206f3b82bdbfff791dcaf5d9918c2afdda0ae2";
const contractPackageCommit = "c0b452da075b66757c60bd0d721a47062d4354d0";

const packageName = "@zudo-composer/ui";

export const UI_PACK = Object.freeze({
  packageName,
  sourcePath: "packages/ui",
  workspaceSpec: "workspace:*",
  packageBranch: handoff.packageBranch,
  packageCommit: handoff.packageCommit,
  rootGitSpec: handoff.rootGitSpec,
  installedVersion: "0.1.0",
  packId: packageName,
  packVersion: "1.0.0",
  sourceModule: packageName,
  provenanceCommit,
});

export const APP_PROVENANCE_COMMIT = appProvenanceCommit;
export const CONTRACT_PACKAGE_COMMIT = contractPackageCommit;

export const PERMANENT_HANDOFF_HASHES = Object.freeze([
  appProvenanceCommit,
  provenanceCommit,
  contractPackageCommit,
  handoff.packageCommit,
]);
