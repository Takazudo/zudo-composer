// @ts-check
// Deliberate corruptions for manager/CI regression proofs. These do not turn an
// expected failure into success: the ordinary packed runner must reject them.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { packPackage, run } from "./packed-host-helpers.mjs";

export const MISSING_RUNTIME = "plugins/roots.mjs";

/** @param {string} toolTarball @param {string} workspace */
export async function packMissingRuntime(toolTarball, workspace) {
  const source = join(workspace, "missing-runtime-source");
  await mkdir(source);
  await run("tar", ["-xzf", toolTarball.slice(5), "-C", source], workspace);
  const packageRoot = join(source, "package");
  // Prove that this file was shipped, then break files rather than deleting an
  // installed file. The second actual pnpm pack must honor the broken allowlist.
  await readFile(join(packageRoot, MISSING_RUNTIME));
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  if (!Array.isArray(manifest.files)) throw new Error("The missing-runtime proof requires the tool files allowlist");
  // pnpm pack removes packageManager. Restore its retained exact engine pin
  // only in this disposable repack source so Corepack cannot select a global
  // fallback before reaching the intended missing-runtime failure.
  if (!manifest.packageManager && typeof manifest.engines?.pnpm === "string") {
    if (!/^\d+\.\d+\.\d+$/.test(manifest.engines.pnpm)) throw new Error("Negative repack requires an exact pnpm engine pin");
    manifest.packageManager = `pnpm@${manifest.engines.pnpm}`;
  }
  manifest.files.push(`!${MISSING_RUNTIME}`);
  await writeFile(join(packageRoot, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const broken = await packPackage(packageRoot, join(workspace, "missing-runtime-tarball"));
  const { stdout } = await run("tar", ["-tzf", broken.slice(5)], workspace);
  if (stdout.split("\n").includes(`package/${MISSING_RUNTIME}`)) throw new Error("The negative pack still shipped the excluded runtime file");
  return broken;
}

/**
 * The control import resolves at the real source host through the repository's
 * node_modules. Only the copy's config imports it; no tracked file is modified.
 * @param {{root: string, sourceHost: string, hostRoot: string, env: NodeJS.ProcessEnv}} options
 */
export async function plantHoistedDependency({ root, sourceHost, hostRoot, env }) {
  const name = `zudo-composer-undeclared-host-proof-${randomUUID()}`;
  const planted = join(root, "node_modules", name);
  const remove = () => rm(planted, { recursive: true, force: true });
  try {
    const manifest = JSON.parse(await readFile(join(hostRoot, "package.json"), "utf8"));
    for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      if (manifest[section]?.[name]) throw new Error("The hoisted negative must remain undeclared");
    }
    await mkdir(planted, { recursive: true });
    await writeFile(join(planted, "package.json"), JSON.stringify({ name, version: "1.0.0", type: "module", exports: "./index.mjs" }));
    await writeFile(join(planted, "index.mjs"), "export const hoistedOnly = true;\n");
    await run(process.execPath, ["--input-type=module", "-e", `
      const control = await import(process.argv[1]);
      if (control.hoistedOnly !== true) throw new Error('Hoisted control import did not execute');
      console.log('Hoisted control import resolved from the source host');
    `, name], sourceHost, { env });
    const configs = (await readdir(hostRoot)).filter((file) => /^zudo-composer\.config\.(?:ts|mts|js|mjs|cts|cjs)$/u.test(file));
    if (configs.length !== 1) throw new Error("The hoisted negative needs exactly one host config");
    const config = join(hostRoot, configs[0]);
    await writeFile(config, `import ${JSON.stringify(name)};\n${await readFile(config, "utf8")}`);
    return { name, remove };
  } catch (error) {
    await remove();
    throw error;
  }
}
