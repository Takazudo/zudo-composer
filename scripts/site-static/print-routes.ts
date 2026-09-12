// Route discovery for `scripts/run-demos-browser.mjs`, which is plain Node
// and cannot import TypeScript directly. Compiles a demo host's committed
// `site-project.json` the way a release does — using the lane's own
// disposable Assets store copy — and prints its route pathnames as JSON.
import { resolve } from "node:path";
import { loadHostContext } from "../../server/host-context.mjs";
import { compileStaticSite } from "../../server/site-build.mjs";

const [packageRoot, assetsStoreRoot] = process.argv.slice(2);
if (!packageRoot || !assetsStoreRoot) {
  console.error("Usage: print-routes.ts <package root> <assets store root>");
  process.exit(1);
}

const { pack } = await loadHostContext({ workspaceRoot: resolve(packageRoot) });
const compiled = await compileStaticSite({
  projectPath: resolve(packageRoot, "site-project.json"),
  pack,
  assetsStoreRoot: resolve(assetsStoreRoot),
});
process.stdout.write(JSON.stringify(compiled.build.routes.map((route) => route.pathname)));
