// @ts-check
import { execFile as execFileCallback } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { resolveDemoEditorHost } from "./demo-editor-hosts.mjs";
import { verifyDemoEditorArtifact } from "./hosted-demo/artifact.mjs";

const execFile = promisify(execFileCallback);
const root = resolve(import.meta.dirname, "..");
const vite = resolve(dirname(createRequire(import.meta.url).resolve("vite/package.json")), "bin/vite.js");

/** Run Vite in a separate process so each host gets a fresh module graph.
 * @param {string} hostDir
 * @param {{execFile?: (file: string, args: string[], options: {cwd: string, env: NodeJS.ProcessEnv, encoding: "utf8", maxBuffer: number}) => Promise<{stdout: string, stderr: string}>, verifyDemoEditorArtifact?: (options: {directory: string}) => ReturnType<typeof verifyDemoEditorArtifact>}} [deps]
 */
export async function buildDemoEditor(hostDir, deps = {}) {
  const host = resolveDemoEditorHost(hostDir);
  const exec = deps.execFile ?? execFile;
  const verify = deps.verifyDemoEditorArtifact ?? verifyDemoEditorArtifact;
  console.log(`Building demo editor: ${host}`);
  try {
    const { stdout, stderr } = await exec(process.execPath, [vite, "build", "--config", resolve(root, "vite.demo-editor.config.ts")], {
      cwd: root,
      // Pin production explicitly: an editor artifact is only ever a
      // production build, so an operator shell (or any caller) that already
      // exports NODE_ENV must not reach the child through ...process.env and
      // silently ship development Preact and dev-JSX source metadata.
      env: { ...process.env, NODE_ENV: "production", ZUDO_DEMO_EDITOR_HOST: host },
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    process.stdout.write(stdout);
    process.stderr.write(stderr);
  } catch (error) {
    // execFile buffers output; retain Vite's diagnostic when a child fails.
    const failure = /** @type {{stdout?: string, stderr?: string}} */ (error);
    if (failure.stdout) process.stdout.write(failure.stdout);
    if (failure.stderr) process.stderr.write(failure.stderr);
    throw error;
  }
  const artifact = await verify({ directory: resolve(host, "dist-editor") });
  console.log(`Demo editor verified: ${artifact.manifest.hostId}, ${Object.keys(artifact.manifest.assets).length} asset files, ${artifact.manifest.routes.length} routes, source ${artifact.manifest.sourceRevision}.`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2).filter((argument) => argument !== "--");
  if (args.length !== 1) throw new Error("Usage: pnpm demo:build-editor <sample|shop|landing|blog|dir>");
  await buildDemoEditor(resolveDemoEditorHost(args[0]));
}
