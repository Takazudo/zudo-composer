import { realpathSync } from "node:fs";
import * as nodeModule from "node:module";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { PackSourceGraph } from "./pack-source-graph";

interface Boundary { confined: Set<string>; allowed: Set<string>; installed: boolean }

// Process-wide, like Node's module cache it protects: a hook outlives any one service instance.
const boundaryKey = Symbol.for("zudo-composer.computed-load-boundary.v1");
const processState = globalThis as typeof globalThis & { [key: symbol]: Boundary | undefined };

export class ComputedLoadBoundaryError extends Error {
  readonly code = "unattested-load";
}

const realPath = (path: string): string | null => {
  try { return realpathSync(path); } catch { return null; }
};
const confinedOwner = (boundary: Boundary, path: string): string | undefined => {
  for (const directory of boundary.confined) if (path === directory || path.startsWith(`${directory}${sep}`)) return directory;
  return undefined;
};

/**
 * Confine every load made by a package whose loads the source graph could not prove to the files that graph
 * attested. A computed `import()` reaching an undeclared, unattested or non-file target then fails at the load,
 * so source identity always covers what actually ran. Without Node's in-thread module hooks this fails closed.
 */
export function enforceComputedLoadBoundary(graph: PackSourceGraph): void {
  const confined = graph.confinedPackages ?? [];
  if (confined.length === 0) return;
  const boundary = processState[boundaryKey] ??= { confined: new Set(), allowed: new Set(), installed: false };
  for (const directory of confined) boundary.confined.add(directory);
  for (const file of graph.attestedFiles ?? []) boundary.allowed.add(file);
  if (boundary.installed) return;
  const registerHooks = (nodeModule as { registerHooks?: (hooks: { resolve: ResolveHook }) => unknown }).registerHooks;
  if (typeof registerHooks !== "function") {
    throw new ComputedLoadBoundaryError(`Installed packages with unprovable loads (${confined.join(", ")}) need Node's module.registerHooks (Node 22.15 or newer) to confine them.`);
  }
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      const parent = context.parentURL;
      if (!parent?.startsWith("file:")) return resolved;
      const owner = confinedOwner(boundary, realPath(fileURLToPath(parent)) ?? fileURLToPath(parent));
      if (owner === undefined || resolved.url.startsWith("node:")) return resolved;
      const target = resolved.url.startsWith("file:") ? realPath(fileURLToPath(resolved.url.replace(/[?#].*$/, ""))) : null;
      if (target === null || !boundary.allowed.has(target)) {
        throw new ComputedLoadBoundaryError(`${owner} loaded "${specifier}" (${resolved.url}), which the source graph did not attest; computed loads are confined to attested files.`);
      }
      return resolved;
    },
  });
  boundary.installed = true;
}

type ResolveHook = (
  specifier: string,
  context: { parentURL?: string; conditions?: string[]; importAttributes?: Record<string, string> },
  nextResolve: (specifier: string, context?: unknown) => { url: string; format?: string | null },
) => { url: string; format?: string | null };
