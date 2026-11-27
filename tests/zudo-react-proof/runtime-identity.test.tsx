import { afterEach, expect, it } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import * as tool from "@takazudo/zfb/zudo-react";
import { flush, h, signal } from "@takazudo/zfb/zudo-react";
import * as jsxRuntime from "@takazudo/zfb/zudo-react/jsx-runtime";
import { PackCard, packCount, packEvents, packRuntime } from "./fixtures/pack/pack-card";
import { mountOwned, type OwnedRoot } from "./support/root";

const repo = resolve(import.meta.dirname, "../..");
const roots: OwnedRoot[] = [];
const temp: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) root.stop();
  for (const dir of temp.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it("resolves one runtime file from the tool and from every pack/demo package anchor", () => {
  const anchors = ["package.json", "packages/ui/package.json", "packages/fixture-themeset/package.json",
    "packages/demo-sample/package.json", "packages/demo-webshop/package.json", "tests/zudo-react-proof/fixtures/pack/pack-card.tsx"];
  const resolved = new Set<string>();
  for (const anchor of anchors) {
    const require = createRequire(join(repo, anchor));
    for (const sub of ["", "/jsx-runtime", "/jsx-dev-runtime", "/client", "/server", "/testing"]) {
      resolved.add(dirname(realpathSync(require.resolve(`@takazudo/zfb/zudo-react${sub}`))));
    }
  }
  expect([...resolved]).toHaveLength(1);
});

it("pack and tool share one module instance: same namespace, scope owner and scheduler", async () => {
  expect(packRuntime).toBe(tool);
  expect(packRuntime.getScope).toBe(tool.getScope);
  expect(jsxRuntime.Fragment).toBe(tool.Fragment);
  packEvents.length = 0;
  const label = signal("tool");
  const root = mountOwned(PackCard, { label });
  roots.push(root);
  expect(root.handle).not.toBeNull();
  label.value = "tool2";
  packCount.value = 5;
  await flush();
  expect(root.host.textContent).toBe("tool2:5");
  root.stop();
  roots.length = 0;
  expect(packEvents).toEqual(["setup", "cleanup"]);
});

it("a duplicated runtime copy passes brand checks, fails getScope loudly and drops signal updates silently", async () => {
  const source = dirname(realpathSync(createRequire(join(repo, "package.json")).resolve("@takazudo/zfb/zudo-react")));
  // Inside the repo's ignored node_modules cache: the Vite module runner only
  // serves files under its fs.allow roots.
  const cache = join(repo, "node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  const dir = mkdtempSync(join(cache, "zr-dup-"));
  temp.push(dir);
  cpSync(source, dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), '{"type":"module"}');
  const dup = (await import(/* @vite-ignore */ join(dir, "index.js"))) as typeof tool;
  expect(dup).not.toBe(tool);
  // Brands are global strings/Symbol.for, so a version check or brand check alone
  // would NOT notice the duplicate: descriptions from either copy look valid.
  expect(dup.Fragment).toBe(tool.Fragment);
  expect(dup.isDescription(h("p", null))).toBe(true);

  function DupScopeCard() {
    dup.getScope();
    return h("p", null, "never");
  }
  const scoped = mountOwned(DupScopeCard, {});
  roots.push(scoped);
  expect(scoped.handle).toBeNull();
  expect(scoped.diagnostics.map((d) => `${d.code}:${d.actual}`).join("\n")).toMatch(/ZR_NO_SCOPE/);

  const dupLabel = dup.signal("before");
  function DupSignalCard() {
    return h("p", null, dupLabel);
  }
  const bound = mountOwned(DupSignalCard, {});
  roots.push(bound);
  // Silent failure: it mounts, reports nothing, then never updates.
  expect(bound.handle).not.toBeNull();
  expect(bound.diagnostics).toEqual([]);
  expect(bound.host.textContent).toBe("before");
  dupLabel.value = "after";
  await dup.flush();
  await flush();
  expect(bound.host.textContent).toBe("before");
});
