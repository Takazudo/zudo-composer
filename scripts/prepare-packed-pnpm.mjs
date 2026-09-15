// @ts-check
import { access, appendFile, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Expose only the action-installed package manager outside node_modules.
 * Execute its original launcher in place: shell launchers use their own path
 * to locate pnpm, so moving or symlinking them changes their behavior.
 * @param {NodeJS.ProcessEnv} [env] */
export async function preparePackedPnpm(env = process.env) {
  for (const key of ["RUNNER_TEMP", "PNPM_HOME", "GITHUB_PATH"]) {
    if (!env[key]) throw new Error(`Missing CI package-manager setting: ${key}`);
  }
  const executable = join(/** @type {string} */ (env.PNPM_HOME), "pnpm");
  await access(executable);
  const bin = await mkdtemp(join(/** @type {string} */ (env.RUNNER_TEMP), "packed-host-bin-"));
  const quoted = "'" + executable.replaceAll("'", "'\\''") + "'";
  await writeFile(join(bin, "pnpm"), `#!/bin/sh\nexec ${quoted} "$@"\n`, { mode: 0o755 });
  await appendFile(/** @type {string} */ (env.GITHUB_PATH), `${bin}\n`);
  return bin;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await preparePackedPnpm();
