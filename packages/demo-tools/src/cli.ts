// `demo-tools <command>`, run from a demo package root.
//
//   generate       site-project.ts → site-project.json
//   seed           seed-assets, then seed-release
//   seed-assets    images-src/manifest.json → cms/assets
//   seed-release   site-project.json → `zudo-composer seed`

import { resolve } from "node:path";
import { generateSiteProject } from "./generate";
import { readAssetManifest, seedAssets, seedRelease } from "./seed";

const USAGE = `Usage: demo-tools <generate | seed | seed-assets | seed-release>

Runs against the demo package in the current directory.
`;

export async function runDemoTools(argv: readonly string[], cwd = process.cwd()): Promise<number> {
  const packageRoot = resolve(cwd);
  const [command] = argv;
  const assets = async () => {
    const result = await seedAssets(packageRoot, await readAssetManifest(packageRoot));
    console.log(`Assets: added ${result.added}, already present ${result.skipped}.`);
  };
  const release = async () => {
    const result = await seedRelease(packageRoot);
    console.log(`Release: ${result.status} ${result.projectId} revision ${result.revision.slice(0, 12)} build ${result.buildId.slice(0, 12)}.`);
  };
  switch (command) {
    case "generate": {
      const result = await generateSiteProject(packageRoot);
      console.log(`${result.changed ? "Wrote" : "Unchanged"} ${result.outputPath}`);
      return 0;
    }
    case "seed": await assets(); await release(); return 0;
    case "seed-assets": await assets(); return 0;
    case "seed-release": await release(); return 0;
    case undefined: case "--help": case "-h": case "help": process.stdout.write(USAGE); return 0;
    default: process.stderr.write(`[demo-tools] Unknown command "${command}".\n\n${USAGE}`); return 1;
  }
}
