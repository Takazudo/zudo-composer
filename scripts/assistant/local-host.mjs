// @ts-check
// Persistent local AI editing host: one command a person runs repeatedly to
// use the AI Assistant against an editable copy of a demo (or the native-edit
// fixture). The first run seeds a workspace-owned host through
// prepareAssistantHost; every later run reuses it, so conversations, Memory,
// the shared draft and applied changes survive restarts. Only an explicit
// `--reset` deletes it, and only a directory this command created.
// Disposable automated-test hosts (verify-assistant-*) stay in fresh temp dirs.
import { readFile, readdir, rm, stat, writeFile, open } from "node:fs/promises";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { DEMOS, prepareAssistantHost } from "./prepare-host.mjs";

const repo = fileURLToPath(new URL("../..", import.meta.url));
export const DEFAULT_ROOT = join(repo, ".zudo-local/assistant");
export const DEFAULT_PORT = 4178;
const RESERVED_PORTS = [4175, 4176, 4177];
const MARKER = ".zudo-local-host.json";
const MARKER_TOOL = "zudo-composer/local-assistant-host";
const LOG = ".zudo-local-host.log";
const CONFIG = "zudo-composer.config.ts";
// The launcher owns exactly this span of the generated host config; the rest is left as seeded.
const MANAGED = /\/\*<local-host>\*\/ .*? \/\*<\/local-host>\*\//u;
const HOSTS = [...Object.keys(DEMOS), "edit-host"];
const PROVIDERS = ["fake", "claude-cli", "codex-cli"];
const USAGE = `Usage: node scripts/assistant/local-host.mjs [--provider fake|claude-cli|codex-cli] [--host sample|landing|blog|webshop|edit-host] [--dir <path>] [--port <n>] [--reset]
  CLI providers: [--executable <name|/abs/path>] [--model <id>] [--effort low|medium|high] [--timeout-ms <n>]
  Env defaults:  ZUDO_CLAUDE_CLI_EXECUTABLE, ZUDO_CLAUDE_CLI_MODEL, ZUDO_CODEX_CLI_EXECUTABLE, ZUDO_CODEX_CLI_MODEL
  --verbose forwards the dev server output; otherwise it goes to <dir>/${LOG}.`;

class UsageError extends Error {}

/** @param {string[]} argv */
function readOptions(argv) {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      provider: { type: "string", default: "fake" },
      host: { type: "string" },
      dir: { type: "string" },
      port: { type: "string", default: String(DEFAULT_PORT) },
      reset: { type: "boolean", default: false },
      executable: { type: "string" },
      model: { type: "string" },
      effort: { type: "string" },
      "timeout-ms": { type: "string" },
      verbose: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) { console.log(USAGE); process.exit(0); }
  const provider = /** @type {"fake" | "claude-cli" | "codex-cli"} */ (values.provider);
  if (!PROVIDERS.includes(provider)) throw new UsageError(`--provider must be one of ${PROVIDERS.join(", ")}.`);
  if (values.host !== undefined && !HOSTS.includes(values.host)) throw new UsageError(`--host must be one of ${HOSTS.join(", ")}.`);
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new UsageError("--port must be an integer between 1024 and 65535.");
  if (RESERVED_PORTS.includes(port)) throw new UsageError(`Port ${port} belongs to another browser lane (${RESERVED_PORTS.join(", ")} are reserved).`);
  const cliOnly = ["executable", "model", "effort", "timeout-ms"].filter(key => values[/** @type {"model"} */ (key)] !== undefined);
  if (provider === "fake" && cliOnly.length) throw new UsageError(`--${cliOnly[0]} applies only to a CLI provider.`);
  if (values.effort !== undefined && !["low", "medium", "high"].includes(values.effort)) throw new UsageError("--effort must be low, medium or high.");
  const timeoutMs = values["timeout-ms"] === undefined ? undefined : Number(values["timeout-ms"]);
  if (timeoutMs !== undefined && !Number.isInteger(timeoutMs)) throw new UsageError("--timeout-ms must be an integer.");
  return { ...values, provider, port, timeoutMs };
}

/** @param {string} dir @returns {Promise<{ tool: string, kind: string, workspaceId: string, pages: { sitemapId: string, pageId: string }[], createdAt: string } | null>} */
async function readMarker(dir) {
  try {
    const marker = JSON.parse(await readFile(join(dir, MARKER), "utf8"));
    return marker?.tool === MARKER_TOOL && HOSTS.includes(marker.kind) ? marker : null;
  } catch { return null; }
}

/** @param {string} dir */
async function isEmptyOrMissing(dir) {
  if (!existsSync(dir)) return true;
  if (!(await stat(dir)).isDirectory()) return false;
  return (await readdir(dir)).length === 0;
}

/** @param {string} kind @param {string} dir */
async function createHost(kind, dir) {
  try {
    const host = await prepareAssistantHost({ kind: /** @type {any} */ (kind), dir });
    const configPath = join(dir, CONFIG);
    const config = await readFile(configPath, "utf8");
    const seeded = /assistant: (\{[^\n{}]*\})/u.exec(config);
    if (!seeded) throw new Error(`Seeded ${CONFIG} has no assistant block to manage.`);
    await writeFile(configPath, config.replace(seeded[0], `assistant: /*<local-host>*/ ${seeded[1]} /*</local-host>*/`));
    const marker = { tool: MARKER_TOOL, kind, workspaceId: host.workspaceId, pages: host.pages, createdAt: new Date().toISOString() };
    await writeFile(join(dir, MARKER), `${JSON.stringify(marker, null, 2)}\n`);
    return marker;
  } catch (error) {
    // Only reached for a directory that was missing or empty before this run.
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

/** @param {string} dir @param {Record<string, unknown>} assistant */
async function writeAssistantConfig(dir, assistant) {
  const configPath = join(dir, CONFIG);
  const config = await readFile(configPath, "utf8");
  const current = MANAGED.exec(config);
  if (!current) throw new Error(`${configPath} no longer has the launcher-managed assistant block; restore it or use --reset.`);
  const previous = JSON.parse(current[0].replace(/^\/\*<local-host>\*\/ /u, "").replace(/ \/\*<\/local-host>\*\/$/u, "") || "{}");
  const next = `/*<local-host>*/ ${JSON.stringify({ name: previous.name ?? "AI Assistant", ...assistant })} /*</local-host>*/`;
  if (next !== current[0]) await writeFile(configPath, config.replace(current[0], () => next));
}

/** @param {string} executable @returns {string | null} */
function findExecutable(executable) {
  const usable = (/** @type {string} */ path) => {
    try { accessSync(path, constants.X_OK); return statSync(path).isFile(); } catch { return false; }
  };
  if (isAbsolute(executable)) return usable(executable) ? executable : null;
  for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const candidate = join(directory, executable);
    if (usable(candidate)) return candidate;
  }
  return null;
}

/**
 * Locates the CLI without running it. Whether it starts, its version and its
 * sign-in are checked by the authoring server itself, which shows them in the
 * Assistant; this launcher never spawns the provider executable.
 * @param {string} executable
 */
function cliStatus(executable) {
  const path = findExecutable(executable);
  if (!path) return isAbsolute(executable) ? `unavailable: ${executable} is not an executable file` : `unavailable: "${executable}" was not found on PATH`;
  return `found ${path} (version and sign-in are shown in the Assistant)`;
}

/** @param {ReturnType<typeof readOptions>} options */
function assistantFor(options) {
  if (options.provider === "fake") return { assistant: { provider: "fake" }, status: "fake — offline and deterministic, never contacts a model" };
  const prefix = options.provider === "claude-cli" ? "ZUDO_CLAUDE_CLI" : "ZUDO_CODEX_CLI";
  const executable = options.executable ?? process.env[`${prefix}_EXECUTABLE`] ?? (options.provider === "claude-cli" ? "claude" : "codex");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(executable) && !(isAbsolute(executable) && !executable.includes("*/"))) throw new UsageError("--executable must be a command name on PATH or an absolute path.");
  const model = options.model ?? process.env[`${prefix}_MODEL`];
  const assistant = { provider: options.provider, executable, ...(model ? { model } : {}), ...(options.effort ? { effort: options.effort } : {}), ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}) };
  return { assistant, status: `${options.provider} — ${cliStatus(executable)}${model ? `, model ${model}` : ""}` };
}

// Ambient storage/pack overrides would point the editable host at other data
// (such as the tracked demo it was seeded from); the host's own config decides.
const HOST_OVERRIDE = /^(?:ZUDO_COMPOSER_(?:DATA_DIR|COMPOSITIONS_DIR|CONTENT_DIR|MAPPINGS_DIR|SITEMAPS_DIR|ASSETS_DIR|PUBLIC_ASSETS_DIR|STYLES|PACK|CONFIG)|ZUDO_(?:COMPOSITIONS_ROOT|ASSETS_STORE_ROOT|SITE_PROJECT_ROOT|DATA_ROOT|HOST_ROOT))$/u;
const hostEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !HOST_OVERRIDE.test(key)));

/** @param {string} origin @param {Promise<unknown>} exited */
async function waitForServer(origin, exited) {
  let done = false;
  exited.then(() => { done = true; });
  const deadline = Date.now() + 180_000;
  while (!done && Date.now() < deadline) {
    try { if ((await fetch(`${origin}/@vite/client`, { signal: globalThis.AbortSignal.timeout(2_000) })).ok) return true; } catch { /* not listening yet */ }
    await new Promise(settle => setTimeout(settle, 500));
  }
  return false;
}

async function main() {
  const options = readOptions(process.argv.slice(2));
  const dir = resolve(options.dir ?? join(DEFAULT_ROOT, options.host ?? "landing"));
  let marker = await readMarker(dir);
  const kind = options.host ?? marker?.kind ?? "landing";

  if (options.reset) {
    if (!(await isEmptyOrMissing(dir))) {
      if (!marker) throw new UsageError(`Refusing to reset ${dir}: it was not created by this command (no ${MARKER}).`);
      await rm(dir, { recursive: true, force: true });
    }
    marker = null;
  } else if (!marker && !(await isEmptyOrMissing(dir))) {
    throw new UsageError(`Refusing to use ${dir}: it is not empty and was not created by this command (no ${MARKER}).`);
  }
  if (marker && marker.kind !== kind) throw new UsageError(`${dir} holds a "${marker.kind}" host, not "${kind}". Omit --host, choose another --dir, or pass --reset.`);

  const { assistant, status } = assistantFor(options);
  const created = !marker;
  if (!marker) {
    console.log(`Creating a new ${kind} host in ${dir} …`);
    marker = await createHost(kind, dir);
  }
  await writeAssistantConfig(dir, assistant);

  const origin = `http://127.0.0.1:${options.port}`;
  const logPath = join(dir, LOG);
  const log = options.verbose ? null : await open(logPath, "w");
  const child = spawn(process.execPath, [join(repo, "bin/zudo-composer.mjs"), "dev", "--host", "127.0.0.1", "--port", String(options.port), "--strict-port"], {
    cwd: dir, env: hostEnv(), detached: true, stdio: ["ignore", log ? log.fd : "inherit", log ? log.fd : "inherit"],
  });
  const exited = new Promise(settle => child.once("close", settle));
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    // The server finishes its own writes and lease release on SIGTERM; never SIGKILL it here.
    try { if (child.pid) process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.on("exit", stop);

  if (!(await waitForServer(origin, exited))) {
    stop();
    const code = await exited;
    await log?.close();
    const tail = log ? (await readFile(logPath, "utf8").catch(() => "")).split("\n").slice(-30).join("\n") : "";
    console.error(`The dev server did not become ready (exit ${code ?? "timeout"}).${tail ? `\n${tail}` : ""}`);
    process.exitCode = 1;
    return;
  }
  const page = marker.pages[0];
  const query = page ? `&sitemap=${encodeURIComponent(page.sitemapId)}&page=${encodeURIComponent(page.pageId)}` : "";
  console.log([
    `Local AI host "${kind}" ${created ? "created" : "reused"} — ${created ? "new data" : `data kept since ${marker.createdAt}`}`,
    `  Open:     ${origin}/composer?assistant=1${query}`,
    `  Provider: ${status}`,
    `  Data:     ${join(dir, "cms")} (assistant/ conversations + Memory, edit-drafts/ shared draft, compositions/ applied pages)`,
    ...(log ? [`  Log:      ${logPath}`] : []),
    `Ctrl+C stops the server and keeps the data; --reset starts over.`,
  ].join("\n"));
  const code = await exited;
  await log?.close();
  process.exitCode = stopping ? 0 : (typeof code === "number" ? code : 1);
}

main().catch(error => {
  console.error(error instanceof UsageError || error?.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION" || error?.code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE" ? `${error.message}\n${USAGE}` : error);
  process.exitCode = 2;
});
