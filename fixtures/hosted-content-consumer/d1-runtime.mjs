// Node launcher code (never Worker runtime code): starts the pinned local workerd through Miniflare with one
// local D1 binding persisted in a host-owned directory. Remote bindings and remote execution are refused.
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { Miniflare } from "miniflare";

export const D1_BINDING = "DB";
export const COMPATIBILITY_DATE = "2026-10-01";

/** Refuse any configuration that would reach Cloudflare: a remote binding, a proxy string, or a remote flag. */
export function assertLocalOnly(config) {
  const text = JSON.stringify(config ?? {});
  if (/"remote"\s*:\s*true/.test(text) || /remoteProxyConnectionString/.test(text)) throw new Error("Remote bindings are refused: this host runs only against local D1 state.");
  for (const argument of process.argv.slice(2)) if (/^--(?:remote|experimental-remote|x-remote)/.test(argument)) throw new Error(`Remote execution flag ${argument} is refused: local only.`);
}

/** Pinned local runtime versions, read from the installed packages (for evidence). */
export async function localRuntimeVersions() {
  const require = createRequire(import.meta.url);
  const version = async name => {
    try { return JSON.parse(await readFile(require.resolve(`${name}/package.json`), "utf8")).version; }
    catch { return null; }
  };
  let workerd;
  try { workerd = JSON.parse(await readFile(createRequire(require.resolve("miniflare")).resolve("workerd/package.json"), "utf8")).version; }
  catch { workerd = null; }
  return { miniflare: await version("miniflare"), workerd, compatibilityDate: COMPATIBILITY_DATE };
}

/**
 * One local runtime. `persist` is the directory whose `d1/` subtree holds the D1 state; disposing the runtime
 * stops the workerd process and starting another on the same directory reopens the same database.
 */
export async function startD1Runtime({ persist, script, name = "article-d1-local", databaseId = "article-cms-local", bindings = {}, log } = {}) {
  if (!persist) throw new Error("A local D1 runtime needs an explicit persistence directory");
  persist = resolve(persist);
  await mkdir(persist, { recursive: true });
  const env = { ...bindings, [D1_BINDING]: { type: "d1", id: databaseId } };
  assertLocalOnly(env);
  const contents = script ?? "export default { fetch() { return new Response('d1 proof runtime'); } };";
  const options = { resourcePersistencePath: persist, ...(log ? { log } : {}), workers: [{ config: {
    name, compatibilityDate: COMPATIBILITY_DATE,
    manifest: { mainModule: "worker.mjs", modules: { "worker.mjs": { type: "esm", contents } } },
    env,
  } }] };
  const runtime = new Miniflare(options);
  await runtime.ready;
  return {
    persist, runtime,
    database: () => runtime.getD1Database(D1_BINDING),
    fetch: (input, init) => runtime.dispatchFetch(input, init),
    dispose: () => runtime.dispose(),
  };
}
