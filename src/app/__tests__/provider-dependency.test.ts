import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SHA = "6b0826cdaa14d9888e58c795ee015f70e2c5cbdf";
const TREE = "1c3cbfd3a25d1425f447cdadd5ba538916394309";
const SPEC = `git+https://github.com/Takazudo/zudo-sg.git#${SHA}`;
const TARBALL = `https://codeload.github.com/Takazudo/zudo-sg/tar.gz/${SHA}`;

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
    };
    expect(pkg.dependencies["@zudo-sg/ui"]).toBe(SPEC);
    expect(pkg.dependencies["@zudo-composer/component-contract"]).toBe("workspace:*");
    expect(pkg.dependencies["@zudo-sg/ui"]).not.toMatch(/(?:^|:)(?:file|link|path):|\.\.|packages\/ui/);
  });

  it("normalizes the lock to the exact full commit without local path leakage", () => {
    const lock = readFileSync(resolve("pnpm-lock.yaml"), "utf8");
    const rootImporter = indentedBlock(section(lock, "importers", "packages"), ".", 2);
    const importer = indentedBlock(rootImporter, "'@zudo-sg/ui'", 6);
    const packageBlock = indentedBlock(section(lock, "packages", "snapshots"), `'@zudo-sg/ui@${TARBALL}'`, 2);
    const snapshotSection = section(lock, "snapshots");
    const snapshotKey = snapshotSection.match(new RegExp(`^  ('@zudo-sg/ui@${TARBALL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^']*'):\\n`, "m"))?.[1];
    expect(snapshotKey).toBeTruthy();
    const snapshot = indentedBlock(snapshotSection, snapshotKey!, 2);

    expect(importer).toContain(`specifier: ${SPEC}`);
    expect(importer).toContain(`version: ${TARBALL}(@zudo-composer/component-contract@packages+component-contract)(preact@10.29.8)(tailwindcss@4.3.3)`);
    expect(packageBlock).toContain(`resolution: {gitHosted: true, tarball: ${TARBALL}}`);
    expect(packageBlock).toContain("version: 0.1.0");
    expect(snapshot).toContain("'@zudo-composer/component-contract': link:packages/component-contract");
    for (const block of [importer, packageBlock, snapshot]) {
      expect(block).not.toMatch(/(?:workspace|file|path|sibling):|\.\.\/|packages\/ui/);
    }
    expect(snapshot.match(/link:packages\/component-contract/g)).toHaveLength(1);
  });

  it("records the independently verified immutable provider tree", () => {
    expect({ commit: SHA, tree: TREE }).toEqual({
      commit: "6b0826cdaa14d9888e58c795ee015f70e2c5cbdf",
      tree: "1c3cbfd3a25d1425f447cdadd5ba538916394309",
    });
  });
});
