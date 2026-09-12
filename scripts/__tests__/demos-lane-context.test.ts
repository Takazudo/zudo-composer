import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { requireDemosLaneContext } from "../../tests/browser-demos/isolated-context";
import { DEMOS_LANE_DIRECTORY } from "../demos-lane-paths.mjs";

const hostRoot = realpathSync(resolve(import.meta.dirname, "../../packages/demo-webshop"));
let temporaryRoot: string;
let runRoot: string;
let environment: NodeJS.ProcessEnv;

beforeEach(() => {
  temporaryRoot = realpathSync(mkdtempSync(join(tmpdir(), "zudo-composer-demos-browser-")));
  runRoot = join(hostRoot, DEMOS_LANE_DIRECTORY, basename(temporaryRoot));
  const cmsRoot = join(runRoot, "cms");
  for (const path of [join(cmsRoot, "assets"), join(cmsRoot, "compositions"), join(temporaryRoot, "release")]) {
    mkdirSync(path, { recursive: true });
  }
  environment = {
    DEMOS_LANE_NAME: "webshop",
    DEMOS_LANE_ROUTES: JSON.stringify(["/", "/products/"]),
    ZUDO_ASSETS_STORE_ROOT: join(cmsRoot, "assets"),
    ZUDO_COMPOSITIONS_ROOT: join(cmsRoot, "compositions"),
    ZUDO_DATA_ROOT: cmsRoot,
    ZUDO_SITE_PROJECT_ROOT: join(temporaryRoot, "release"),
  };
});

afterEach(() => {
  rmSync(runRoot, { recursive: true, force: true });
  rmSync(temporaryRoot, { recursive: true, force: true });
});

describe("demos browser disposable context", () => {
  it("accepts the runner's host-local CMS copy and paired temporary release", () => {
    expect(requireDemosLaneContext(environment)).toEqual({
      name: "webshop", assetsStoreRoot: environment.ZUDO_ASSETS_STORE_ROOT,
      routes: ["/", "/products/"],
    });
  });

  it("rejects the retired Assets-only temporary layout", () => {
    const assets = join(temporaryRoot, "assets");
    mkdirSync(assets);
    expect(() => requireDemosLaneContext({ ...environment, ZUDO_ASSETS_STORE_ROOT: assets })).toThrow();
  });

  it("rejects the committed Assets store", () => {
    expect(() => requireDemosLaneContext({ ...environment, ZUDO_ASSETS_STORE_ROOT: join(hostRoot, "cms/assets") })).toThrow();
  });

  it("rejects a copy belonging to another named host", () => {
    expect(() => requireDemosLaneContext({ ...environment, DEMOS_LANE_NAME: "landing" })).toThrow();
  });

  it("rejects a disposable-looking symlink to committed Assets", () => {
    const assets = environment.ZUDO_ASSETS_STORE_ROOT!;
    rmSync(assets, { recursive: true });
    symlinkSync(join(hostRoot, "cms/assets"), assets, "dir");
    expect(() => requireDemosLaneContext(environment)).toThrow();
  });

  it("rejects a release that is not paired with this CMS copy", () => {
    const otherRun = realpathSync(mkdtempSync(join(tmpdir(), "zudo-composer-demos-browser-")));
    try {
      const release = join(otherRun, "release");
      mkdirSync(release);
      expect(() => requireDemosLaneContext({ ...environment, ZUDO_SITE_PROJECT_ROOT: release })).toThrow();
    } finally {
      rmSync(otherRun, { recursive: true, force: true });
    }
  });

  it.each(["ZUDO_DATA_ROOT", "ZUDO_COMPOSITIONS_ROOT"])("rejects an inherited %s outside the copy", (key) => {
    expect(() => requireDemosLaneContext({ ...environment, [key]: join(hostRoot, "cms") })).toThrow();
  });
});
