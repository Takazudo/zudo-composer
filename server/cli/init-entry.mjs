// @ts-check
import { initHostProject } from "../creator/init.mjs";
import { parseArguments, USAGE } from "./run.mjs";

const parsed = parseArguments(["init", ...process.argv.slice(2)]);
if ("error" in parsed) {
  process.stderr.write(`[zudo-composer] ${parsed.error}\n\n${USAGE}`);
  process.exitCode = 1;
} else if (parsed.command === "init") {
  try {
    const result = await initHostProject(parsed.options, { log: (message) => process.stderr.write(`${message}\n`) });
    process.stdout.write(`Created populated host ${result.name} in ${result.directory}.\n`);
    if (result.preview) process.stdout.write("Preview uses unpublished packages: install this output with matching packed dependencies until those versions are published. Temporary overrides and lockfile were not retained.\n");
    else process.stdout.write("Install dependencies in the new directory with corepack pnpm install --frozen-lockfile, then corepack pnpm dev.\n");
    process.stdout.write("Commit the generated source, CMS records, public assets and package-manager files together. Opening the studio needs no seed command.\n");
  } catch (error) {
    process.stderr.write(`[zudo-composer] init failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
} else process.stdout.write(USAGE);
