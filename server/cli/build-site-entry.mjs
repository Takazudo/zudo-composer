// @ts-check
// The supervised child behind `zudo-composer build-site`.
import { parseArguments, USAGE } from "./run.mjs";
import { runSiteBuild } from "../site-build/run.mjs";

const parsed = parseArguments(["build-site", ...process.argv.slice(2)]);
if ("error" in parsed) {
  process.stderr.write(`[zudo-composer] ${parsed.error}\n\n${USAGE}`);
  process.exitCode = 1;
} else if (parsed.command === "build-site") {
  try {
    const manifest = await runSiteBuild(parsed.options);
    process.stdout.write(parsed.options.printRoutes
      ? `${JSON.stringify(manifest.routes)}\n`
      : `Static site verified: ${manifest.projectId}, ${Object.keys(manifest.files).length} files, ${manifest.routes.length} routes, source ${manifest.sourceRevision}.\n`);
  } catch (error) {
    process.stderr.write(`[zudo-composer] build-site failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
} else {
  process.stdout.write(USAGE);
}
