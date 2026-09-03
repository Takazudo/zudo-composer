import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = resolve(import.meta.dirname, "..");
const argumentsList = process.argv.slice(2);
const mode = argumentsList[0] === "--dist" ? "dist" : argumentsList[0] === "--dev" ? "dev" : null;
if (!mode || argumentsList.length !== 1) {
  throw new Error("Usage: node scripts/run-site-project-browser.mjs --dev|--dist");
}

function run(command, args, { input, ...options } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ["pipe", "pipe", "pipe"], ...options });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (status, signal) => resolveRun({ status, signal, stdout, stderr }));
    if (input !== undefined) child.stdin?.end(input);
  });
}

function parseCli(result, operation) {
  if (result.status !== 0) throw new Error(`${operation} exited ${result.status}: ${result.stderr || result.stdout}`);
  let response;
  try { response = JSON.parse(result.stdout); }
  catch (error) { throw new Error(`${operation} did not return one JSON response: ${result.stdout}`, { cause: error }); }
  if (!response.ok) throw new Error(`${operation} was rejected: ${JSON.stringify(response.error)}`);
  return response.result;
}

async function runCli(request, environment) {
  const result = await run(process.execPath, ["--import", "tsx", "server/site-project-local/cli.ts"], {
    env: { ...process.env, ...environment },
    input: `${JSON.stringify(request)}\n`,
  });
  return parseCli(result, request.operation);
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "zudo-composer-site-project-browser-"));
try {
  const environment = {
    ZUDO_SITE_PROJECT_ROOT: temporaryRoot,
    SITE_PROJECT_BROWSER_LANE: mode,
  };
  const sample = JSON.parse(await readFile(join(root, "src/site-project/sample/sample-site-project.json"), "utf8"));
  const project = mode === "dist"
    ? { ...globalThis.structuredClone(sample), id: "browser-disposable-project", name: "Disposable browser project" }
    : sample;
  const applyResult = await runCli({
    protocolVersion: 1,
    operation: "apply",
    project,
    expectedRevision: null,
    expectedActive: null,
  }, environment);
  const revision = applyResult.revision;
  if (typeof revision !== "string" || !/^[a-f0-9]{64}$/u.test(revision)) throw new Error("CLI apply did not return a revision digest.");
  await runCli({
    protocolVersion: 1,
    operation: "activate",
    projectId: project.id,
    revision,
    expectedActive: null,
  }, environment);

  if (mode === "dist") await access(join(root, "dist", "index.html"));
  const playwright = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const config = mode === "dev" ? "playwright.site-project.config.ts" : "playwright.site-project-dist.config.ts";
  const result = await run(playwright, ["exec", "playwright", "test", "--config", config, "tests/browser/site-project-acceptance.pw.ts"], {
    env: { ...process.env, ...environment },
    stdio: "inherit",
  });
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
