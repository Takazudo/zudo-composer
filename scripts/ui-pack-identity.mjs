// @ts-check

// Single source of truth for the installed Composer UI component provider's
// identity (#699, from epic #686's "Decision (from C0)" table). Every
// boundary gate, unit test and browser proof that asserts "this exact
// package, this exact pin" reads from here instead of repeating the
// literals, so C2's atomic cutover to the owned `@zudo-composer/ui` package
// flips this one module instead of a dozen call sites. The values below are
// still the current zudo-sg ones; behavior does not change in this sub-issue.
//
// Imported by scripts, unit tests and tests/browser only — never by shipped
// code, since `scripts/` is excluded from the published tarball.

const providerCommit = "6b0826cdaa14d9888e58c795ee015f70e2c5cbdf";
const providerTree = "1c3cbfd3a25d1425f447cdadd5ba538916394309";
const appProvenanceCommit = "f1206f3b82bdbfff791dcaf5d9918c2afdda0ae2";
const contractPackageCommit = "c0b452da075b66757c60bd0d721a47062d4354d0";

const packageName = "@zudo-sg/ui";
const dependencySpec = `git+https://github.com/Takazudo/zudo-sg.git#${providerCommit}`;
const tarballUrl = `https://codeload.github.com/Takazudo/zudo-sg/tar.gz/${providerCommit}`;

export const UI_PACK = Object.freeze({
  packageName,
  dependencySpec,
  installedVersion: "0.1.0",
  packId: "@zudo-sg/ui",
  packVersion: "1.0.0",
  sourceModule: "@zudo-sg/ui",
  provenanceCommit: providerCommit,
  provenanceTree: providerTree,
  lock: Object.freeze({
    tarballUrl,
    // pnpm appends the resolved peer set to a Git-hosted tarball's `version:`
    // field in the lockfile; this is that suffix for the provider's current peers.
    peerResolutionSuffix: "(@zudo-composer/component-contract@packages+component-contract)(preact@10.29.8)(tailwindcss@4.3.3)",
  }),
});

// The contract and app-provenance commits are not the UI provider's own
// identity, but they share the README/CLAUDE permanent-handoff hash set below,
// so they are named here rather than re-declared at each call site.
export const APP_PROVENANCE_COMMIT = appProvenanceCommit;
export const CONTRACT_PACKAGE_COMMIT = contractPackageCommit;

export const PERMANENT_HANDOFF_HASHES = Object.freeze([
  appProvenanceCommit,
  providerCommit,
  providerTree,
  contractPackageCommit,
]);
