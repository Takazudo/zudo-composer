import { readFile, readdir, realpath } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { BuildEnvironment, createIdResolver, parseAst, resolveConfig, transformWithOxc } from "vite";
import { resolveComposerModules } from "../../plugins/module-resolution.mjs";
import { tailwindResolverAlias } from "../../plugins/tailwind-plugin.mjs";

export interface PackSourceDependency {
  readonly name: string;
  readonly version: string;
}

export interface PackSourceGraph {
  /** Host-root-relative POSIX paths, sorted by code point, deduped, in-host only (no node_modules). */
  readonly files: readonly string[];
  /** Sorted by name (code point), deduped. */
  readonly dependencies: readonly PackSourceDependency[];
  /** Editing-only full executed graph, including installed dependency bytes. */
  readonly attestedFiles?: readonly string[];
  /**
   * Editing-only real paths of installed packages with a load the walk cannot prove. Their attestation is
   * complete only while `enforceComputedLoadBoundary` confines what those packages load to `attestedFiles`.
   */
  readonly confinedPackages?: readonly string[];
}

export interface CollectPackSourceGraphOptions {
  readonly hostRoot: string;
  readonly attestExternalFiles?: boolean;
  /** Absolute path of the pack entry module. */
  readonly entryPath: string;
  /** Every component `source.module` specifier, resolved from the host root. */
  readonly sourceModules: readonly string[];
  /** Further absolute root files, e.g. the host `styles` entry. */
  readonly extraRoots?: readonly string[];
}

const SCRIPT_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const ATTEST_ONLY_QUERIES = new Set(["raw", "url"]);
const FOLLOW_QUERIES = new Set(["inline"]);

type Node = { type: string; [key: string]: unknown };
type Resolver = (specifier: string, importer: string | undefined) => Promise<string | undefined>;

const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

class PackSourceGraphError extends Error {}

function fail(message: string): never {
  throw new PackSourceGraphError(`Pack source graph: ${message}`);
}

/**
 * Walk every module a host-self pack loads, resolving through the same Vite
 * resolver options `createModuleEvaluator` uses. Anything the walk cannot
 * prove statically (computed dynamic imports, globs, computed asset URLs, a
 * path leaving the host root) is refused rather than silently left out.
 */
export async function collectPackSourceGraph(options: CollectPackSourceGraphOptions): Promise<PackSourceGraph> {
  const hostRoot = await realpath(resolve(options.hostRoot));
  // preserveSymlinks keeps an installed dependency on its `node_modules/<name>`
  // link path, so a workspace-linked package is still recognised as installed.
  // The Tailwind alias resolves `tailwindcss/*` from the tool root, exactly as
  // the site build and dev server do: an isolated host install has no
  // `tailwindcss` of its own.
  const composerModules = resolveComposerModules();
  const config = await resolveConfig(
    {
      configFile: false,
      root: hostRoot,
      logLevel: "silent",
      resolve: { ...composerModules, alias: [...composerModules.alias, tailwindResolverAlias()], preserveSymlinks: true },
    },
    "serve",
  );
  const environment = new BuildEnvironment("ssr", config);
  const scriptResolver = createIdResolver(config);
  // Mirrors Vite's CSS `@import` resolver.
  const cssResolver = createIdResolver(config, {
    extensions: [".css"],
    mainFields: ["style"],
    conditions: ["style"],
    preferRelative: true,
    tryIndex: false,
  });
  const resolveScript: Resolver = (specifier, importer) => scriptResolver(environment, specifier, importer);
  const resolveCss: Resolver = (specifier, importer) => cssResolver(environment, specifier, importer);

  const files = new Set<string>();
  const attestedFiles = new Set<string>();
  const dependencies = new Map<string, PackSourceDependency>();
  const followed = new Set<string>();
  const widened = new Set<string>();
  const confined = new Set<string>();
  const queue: string[] = [];

  async function admit(resolvedId: string, from: string, follow: boolean): Promise<void> {
    if (resolvedId.startsWith("\0") || !isAbsolute(resolvedId)) fail(`"${from}" resolved to non-file module "${resolvedId}".`);
    const path = resolve(resolvedId);
    const segments = path.split(sep);
    const modulesIndex = segments.lastIndexOf("node_modules");
    if (modulesIndex !== -1) {
      await admitDependency(segments, modulesIndex, from);
      if (!options.attestExternalFiles) return;
    }
    let real: string;
    try {
      real = await realpath(path);
    } catch (error) {
      fail(`"${from}" resolved to "${path}", which cannot be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (options.attestExternalFiles) {
      attestedFiles.add(real);
      if (follow && !followed.has(real)) { followed.add(real); queue.push(real); }
      return;
    }
    const inHost = relative(hostRoot, real);
    if (inHost === "" || inHost.startsWith(`..${sep}`) || inHost === ".." || isAbsolute(inHost)) {
      fail(`"${from}" resolves to "${real}", outside the host root ${hostRoot}.`);
    }
    files.add(inHost.split(sep).join("/"));
    if (follow && !followed.has(real)) {
      followed.add(real);
      queue.push(real);
    }
  }

  async function admitDependency(segments: string[], modulesIndex: number, from: string): Promise<void> {
    const first = segments[modulesIndex + 1];
    const nameSegments = first?.startsWith("@") ? segments.slice(modulesIndex + 1, modulesIndex + 3) : segments.slice(modulesIndex + 1, modulesIndex + 2);
    const packageDir = segments.slice(0, modulesIndex + 1 + nameSegments.length).join(sep);
    let manifest: { name?: unknown; version?: unknown };
    try {
      manifest = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));
    } catch (error) {
      fail(`"${from}" resolves into ${packageDir}, whose package.json cannot be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (typeof manifest.name !== "string" || typeof manifest.version !== "string") {
      fail(`${join(packageDir, "package.json")} (reached from "${from}") must declare a string name and version.`);
    }
    dependencies.set(`${manifest.name}\0${manifest.version}`, { name: manifest.name, version: manifest.version });
  }

  async function admitSpecifier(specifier: string, importer: string, resolver: Resolver): Promise<void> {
    if (isBuiltin(specifier)) return;
    const from = `${specifier}" in "${relative(hostRoot, importer).split(sep).join("/")}`;
    const [bare, query] = splitQuery(specifier);
    let follow = true;
    if (query !== undefined) {
      if (ATTEST_ONLY_QUERIES.has(query)) follow = false;
      else if (!FOLLOW_QUERIES.has(query)) fail(`"${from}" uses the unsupported import query "?${query}".`);
    }
    const resolvedId = await resolver(bare, importer);
    if (resolvedId === undefined) fail(`"${from}" does not resolve.`);
    await admit(splitQuery(resolvedId)[0], from, follow);
  }

  async function admitRoot(path: string, from: string): Promise<void> {
    if (!options.attestExternalFiles && path.split(sep).includes("node_modules")) fail(`${from} (${path}) is an installed package, not host-owned source.`);
    await admit(path, from, true);
  }

  await admitRoot(resolve(options.entryPath), "the pack entry");
  for (const extra of options.extraRoots ?? []) await admitRoot(resolve(extra), `root "${extra}"`);
  for (const specifier of options.sourceModules) {
    const resolvedId = await resolveScript(specifier, undefined);
    if (resolvedId === undefined) fail(`source.module "${specifier}" does not resolve from ${hostRoot}.`);
    await admitRoot(splitQuery(resolvedId)[0], `source.module "${specifier}"`);
  }

  // An installed file whose loads cannot be proven statically (a computed
  // `import()` in a WASM loader, say) could reach any file at all, so a
  // declaration is no confinement. The editing attestation widens to its own
  // package and the packages it declares: every byte is attested, every module
  // in it is followed like a statically reached one, and an undeclared or
  // missing dependency refuses the graph. The package is then recorded as
  // confined, and `enforceComputedLoadBoundary` refuses at load time anything
  // it resolves outside the attested files. Host-owned source still fails closed.
  async function widenToPackage(file: string, reason: string): Promise<void> {
    const segments = file.split(sep);
    const modulesIndex = segments.lastIndexOf("node_modules");
    const inHost = relative(hostRoot, file);
    const hostOwned = !inHost.startsWith(`..${sep}`) && !isAbsolute(inHost) && !inHost.split(sep).includes("node_modules");
    if (!options.attestExternalFiles || modulesIndex === -1 || hostOwned) fail(reason);
    const scoped = segments[modulesIndex + 1]?.startsWith("@") ?? false;
    const packageDir = segments.slice(0, modulesIndex + (scoped ? 3 : 2)).join(sep);
    confined.add(await realpath(packageDir));
    await widenPackageDir(packageDir, reason);
  }

  async function widenPackageDir(packageDir: string, reason: string): Promise<void> {
    if (widened.has(packageDir)) return;
    widened.add(packageDir);
    const segments = packageDir.split(sep);
    await admitDependency(segments, segments.lastIndexOf("node_modules"), reason);
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name === "node_modules") continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (entry.isFile()) {
          const real = await realpath(path);
          attestedFiles.add(real);
          const extension = extname(real);
          if ((SCRIPT_EXTENSIONS.has(extension) || extension === ".css") && !/\.d\.[cm]?ts$/.test(real) && !followed.has(real)) {
            followed.add(real);
            queue.push(real);
          }
        }
        else fail(`${path} (in installed package ${packageDir}) is neither a regular file nor a directory; ${reason}`);
      }
    };
    await walk(packageDir);
    let manifest: { dependencies?: unknown; optionalDependencies?: unknown; peerDependencies?: unknown; peerDependenciesMeta?: unknown };
    try {
      manifest = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));
    } catch (error) {
      fail(`${join(packageDir, "package.json")} cannot be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    const names = (value: unknown) => value !== null && typeof value === "object" ? Object.keys(value) : [];
    const optional = new Set([...names(manifest.optionalDependencies), ...names(manifest.peerDependencies)]);
    for (const name of [...new Set([...names(manifest.dependencies), ...optional])].sort(byCodePoint)) {
      const found = await findInstalledPackage(packageDir, name);
      if (found === undefined) {
        if (optional.has(name)) continue;
        fail(`${packageDir} declares "${name}", which is not installed where it can be reached; ${reason}`);
      }
      await widenPackageDir(found, `${reason} (via ${packageDir})`);
    }
  }

  while (queue.length > 0) {
    const file = queue.shift()!;
    const extension = extname(file);
    if (SCRIPT_EXTENSIONS.has(extension)) {
      const { specifiers, unprovable } = await scriptSpecifiers(file, hostRoot);
      if (unprovable !== undefined) await widenToPackage(file, unprovable);
      for (const specifier of specifiers) {
        await admitSpecifier(specifier.value, file, specifier.relativeToFile ? relativeFileResolver(file) : resolveScript);
      }
    } else if (extension === ".css") {
      const { imports, urls, plugins } = cssSpecifiers(await readFile(file, "utf8"));
      for (const specifier of imports) await admitSpecifier(specifier, file, resolveCss);
      for (const specifier of urls) {
        // Vite leaves an unresolvable root-absolute url() (a publicDir file) untouched.
        if (specifier.startsWith("/") && await resolveCss(specifier, file) === undefined) continue;
        await admitSpecifier(specifier, file, resolveCss);
      }
      for (const specifier of plugins) await admitSpecifier(specifier, file, resolveScript);
    }
  }

  return {
    files: [...files].sort(byCodePoint),
    ...(options.attestExternalFiles ? { attestedFiles: [...attestedFiles].sort(byCodePoint), confinedPackages: [...confined].sort(byCodePoint) } : {}),
    dependencies: [...dependencies.values()].sort((a, b) => byCodePoint(a.name, b.name) || byCodePoint(a.version, b.version)),
  };
}

/** Node's lookup: `<ancestor>/node_modules/<name>` from the package directory upward. */
async function findInstalledPackage(packageDir: string, name: string): Promise<string | undefined> {
  for (let directory = packageDir; ; directory = dirname(directory)) {
    if (basename(directory) !== "node_modules") {
      const candidate = join(directory, "node_modules", ...name.split("/"));
      try {
        await readFile(join(candidate, "package.json"));
        return candidate;
      } catch { /* keep looking upward */ }
    }
    if (dirname(directory) === directory) return undefined;
  }
}

function splitQuery(id: string): [string, string | undefined] {
  const index = id.search(/[?#]/);
  return index === -1 ? [id, undefined] : [id.slice(0, index), id.slice(index + 1) || undefined];
}

function relativeFileResolver(importer: string): Resolver {
  // `new URL("./x", import.meta.url)` is plain URL arithmetic, not module resolution.
  return async (specifier) => resolve(dirname(importer), specifier);
}

async function scriptSpecifiers(file: string, hostRoot: string): Promise<{ specifiers: { value: string; relativeToFile: boolean }[]; unprovable?: string }> {
  const source = await readFile(file, "utf8");
  const extension = extname(file);
  const where = relative(hostRoot, file).split(sep).join("/");
  const code = extension === ".js" || extension === ".mjs" || extension === ".cjs"
    ? source
    : (await transformWithOxc(source, file, { jsx: { runtime: "automatic", importSource: "preact" } })).code;
  let program: Node;
  try {
    program = parseAst(code) as unknown as Node;
  } catch (error) {
    fail(`${where} cannot be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const found: { value: string; relativeToFile: boolean }[] = [];
  // The caller decides whether an unprovable load fails or widens the attestation.
  let unprovable: string | undefined;
  const refuse = (reason: string) => { unprovable ??= reason; };
  visit(program, (node) => {
    switch (node.type) {
      case "ImportDeclaration":
      case "ExportAllDeclaration":
      case "ExportNamedDeclaration": {
        const value = literalString(node.source);
        if (value !== undefined) found.push({ value, relativeToFile: false });
        break;
      }
      case "ImportExpression": {
        const value = literalString(node.source);
        if (value === undefined) { refuse(`${where} has a dynamic import() whose specifier is not a string literal.`); break; }
        found.push({ value, relativeToFile: false });
        break;
      }
      case "CallExpression": {
        const callee = node.callee as Node;
        if (callee.type === "Identifier" && callee.name === "require") {
          const value = literalString((node.arguments as Node[])[0]);
          if (value === undefined) { refuse(`${where} has a require() whose specifier is not a string literal.`); break; }
          found.push({ value, relativeToFile: false });
        }
        break;
      }
      case "MemberExpression":
        if (isImportMeta(node.object) && propertyName(node) !== undefined && propertyName(node)!.startsWith("glob")) {
          refuse(`${where} uses import.meta.${propertyName(node)}, whose matches cannot be attested statically.`);
        }
        break;
      case "NewExpression": {
        const callee = node.callee as Node;
        const args = node.arguments as Node[];
        if (callee.type === "Identifier" && callee.name === "URL" && args.length >= 2 && isImportMetaUrl(args[1])) {
          const value = literalString(args[0]);
          if (value === undefined) { refuse(`${where} has new URL(…, import.meta.url) whose first argument is not a string literal.`); break; }
          found.push({ value, relativeToFile: true });
        }
        break;
      }
    }
  });
  return { specifiers: found, unprovable };
}

function visit(node: unknown, onNode: (node: Node) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) visit(child, onNode);
    return;
  }
  if (node === null || typeof node !== "object" || typeof (node as Node).type !== "string") return;
  onNode(node as Node);
  for (const [key, child] of Object.entries(node)) {
    if (key !== "type" && child !== null && typeof child === "object") visit(child, onNode);
  }
}

function literalString(node: unknown): string | undefined {
  if (node === null || typeof node !== "object") return undefined;
  const candidate = node as Node;
  if (candidate.type === "Literal" && typeof candidate.value === "string") return candidate.value;
  if (candidate.type === "TemplateLiteral" && (candidate.expressions as unknown[]).length === 0) {
    const quasis = candidate.quasis as { value: { cooked: string | null } }[];
    return quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
}

function isImportMeta(node: unknown): boolean {
  const candidate = node as Node | null;
  return candidate?.type === "MetaProperty"
    && (candidate.meta as Node).name === "import"
    && (candidate.property as Node).name === "meta";
}

function propertyName(node: Node): string | undefined {
  const property = node.property as Node;
  if (!node.computed && property.type === "Identifier") return property.name as string;
  return literalString(property);
}

function isImportMetaUrl(node: unknown): boolean {
  const candidate = node as Node | null;
  return candidate?.type === "MemberExpression" && isImportMeta(candidate.object) && propertyName(candidate) === "url";
}

const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;
const CSS_IMPORT = /@import\s+(?:url\(\s*(["']?)([^"')]+)\1\s*\)|(["'])(.+?)\3)[^;]*;?/g;
const CSS_URL = /url\(\s*(["']?)([^"')]*)\1\s*\)/g;
// Tailwind's `@plugin` / `@config` load JavaScript modules.
const CSS_CODE_DIRECTIVE = /@(?:plugin|config)\s+(["'])(.+?)\1/g;

function cssSpecifiers(source: string): { imports: string[]; urls: string[]; plugins: string[] } {
  const stripped = source.replace(CSS_COMMENT, "");
  const plugins = [...stripped.matchAll(CSS_CODE_DIRECTIVE)].map((match) => match[2]!);
  const imports: string[] = [];
  const rest = stripped.replace(CSS_IMPORT, (_match, _q1, urlValue: string | undefined, _q2, quotedValue: string | undefined) => {
    imports.push((urlValue ?? quotedValue ?? "").trim());
    return "";
  });
  const urls: string[] = [];
  for (const match of rest.matchAll(CSS_URL)) {
    const value = match[2]!.trim();
    if (value === "" || /^(?:data:|#|[a-z][a-z\d+.-]*:\/\/|\/\/)/i.test(value)) continue;
    // A fragment or cache-busting query (`sprite.svg#icon`, `font.eot?#iefix`) addresses the same file.
    urls.push(value.replace(/[?#].*$/, ""));
  }
  return { imports: imports.filter((value) => !/^(?:[a-z][a-z\d+.-]*:\/\/|\/\/)/i.test(value)), urls, plugins };
}
