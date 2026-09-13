// @ts-check
import { execFile as execFileCallback } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { resolveDemoEditorHost } from "./demo-editor-hosts.mjs";

const execFile = promisify(execFileCallback);
const root = resolve(import.meta.dirname, "..");
const vite = resolve(dirname(createRequire(import.meta.url).resolve("vite/package.json")), "bin/vite.js");

/** Run Vite in a separate process so each host gets a fresh module graph.
 * @param {string} hostDir
 */
export async function buildDemoEditor(hostDir) {
  const host = resolveDemoEditorHost(hostDir);
  console.log(`Building demo editor: ${host}`);
  try {
    const { stdout, stderr } = await execFile(process.execPath, [vite, "build", "--config", resolve(root, "vite.demo-editor.config.ts")], {
      cwd: root,
      env: { ...process.env, ZUDO_DEMO_EDITOR_HOST: host },
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
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2).filter((argument) => argument !== "--");
  if (args.length !== 1) throw new Error("Usage: pnpm demo:build-editor <sample|shop|landing|blog|dir>");
  await buildDemoEditor(resolveDemoEditorHost(args[0]));
}
