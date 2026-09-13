// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { checkNoDeploy, shellCommands } from "../check-no-deploy.mjs";
import { discoverPackedHosts, packedHostMatrix } from "../packed-host-helpers.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const temporaries: string[] = [];
afterEach(async () => { await Promise.all(temporaries.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function put(root: string, path: string, text: string) {
  await mkdir(resolve(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), text);
}
async function fixture(command = "node scripts/verify.mjs", extra: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), "no-deploy-test-"));
  temporaries.push(root);
  await put(root, "package.json", JSON.stringify({ name: "zudo-composer", scripts: { check: command, "hosted-demo:deploy": "node scripts/hosted-demo/deploy.mjs", ...extra } }));
  await put(root, "scripts/verify.mjs", "console.log('Verified');\n");
  return root;
}
const audit = (root: string) => checkNoDeploy({ root, entries: ["check"] });

describe("reachable validation commands cannot deploy", () => {
  it("audits the actual repository without executing a build, browser or mutation", () => {
    const result = checkNoDeploy({ root: repositoryRoot });
    expect(result.scripts).toBeGreaterThan(30);
    expect(result.workflows).toBe(1);
    expect(result.sources).toBeGreaterThan(30);
  });

  it("keeps an unreachable production entry while allowing explicit build, verify and dry-run commands", async () => {
    const root = await fixture("pnpm verify && pnpm preview", { verify: "node scripts/verify.mjs", preview: "corepack pnpm exec wrangler deploy --dry-run --config wrangler.jsonc" });
    await put(root, ".github/workflows/hosted-demo-deploy.yml", "jobs:\n  production:\n    steps:\n      - run: pnpm hosted-demo:deploy\n");
    expect(() => audit(root)).not.toThrow();
  });

  it.each([
    "pnpm hosted-demo:deploy",
    "corepack pnpm run hosted-demo:deploy",
    "pnpm exec wrangler deploy",
    "wrangler versions upload",
    "wrangler versions deploy 123",
    "wrangler rollback",
    "wrangler delete",
    "wrangler kv key put key value",
    "wrangler d1 execute database --remote --command DROP",
    "wrangler deploy --dry-run=false",
    "wrangler deploy --dry-run false",
    "wrangler deploy --dry-run --no-dry-run",
    "wrangler versions upload --dry-run",
    "wrangler deploy --dry-run && wrangler deploy",
    "wrangler deploy --dry-run | pnpm hosted-demo:deploy",
    "node scripts/hosted-demo/deploy.mjs",
    "node node_modules/wrangler/bin/wrangler.js deploy",
    "curl -X POST https://api.cloudflare.com/client/v4/accounts/example/workers/scripts/example",
  ])("rejects a planted mutation: %s", async (command) => {
    const root = await fixture(command);
    expect(() => audit(root)).toThrow(/No-deploy assertion/u);
  });

  it("follows multiple script aliases and lifecycle hooks", async () => {
    const root = await fixture("pnpm build-proof", { "build-proof": "pnpm delivery", delivery: "pnpm hosted-demo:deploy" });
    expect(() => audit(root)).toThrow(/hosted-demo:deploy/u);
    const hook = await fixture("pnpm build", { build: "node scripts/verify.mjs", prebuild: "pnpm hosted-demo:deploy" });
    expect(() => audit(hook)).toThrow(/hosted-demo:deploy/u);
  });

  it("follows executable shell wrappers, preserving adjacent quoted words and command boundaries", async () => {
    const root = await fixture("./scripts/validate.sh");
    await put(root, "scripts/validate.sh", "#!/bin/sh\nnode scripts/verify.mjs\ncorepack pnpm 'hosted-demo:'\"deploy\"\n");
    expect(() => audit(root)).toThrow(/hosted-demo:deploy/u);
    expect(shellCommands("pnpm 'hosted-demo:'\"deploy\" && echo verified # prose\n")).toEqual([["pnpm", "hosted-demo:deploy"], ["echo", "verified"]]);
  });

  it.each([
    "import { execFileSync as execute } from 'node:child_process'; execute('pnpm', ['run', 'release-it']);",
    "import { execSync } from 'node:child_process'; const prefix = 'hosted-demo:'; const verb = 'deploy'; execSync('pnpm ' + prefix + verb);",
    "import { execFileSync } from 'node:child_process'; function launch(cmd, args) { execFileSync(cmd, args); } launch('pnpm', ['run', 'release-it']);",
    "import { execFileSync } from 'node:child_process'; function pnpm(args) { execFileSync('corepack', ['pnpm', ...args]); } pnpm(['run', 'release-it']);",
    "import { execSync } from 'node:child_process'; function launch(cmd) { execSync(cmd); } launch('pnpm hosted-demo:deploy');",
    "import { execFileSync } from 'node:child_process'; const command = 'wrang' + 'ler'; const args = ['versions', 'upload']; execFileSync(command, args);",
    "import * as processes from 'node:child_process'; processes.execFileSync('pnpm', ['run', 'release-it']);",
    "function supervise({ command, args }) {} supervise({ command: 'pnpm', args: ['run', 'release-it'] });",
    "import { execFileSync } from 'node:child_process'; const options = { command: 'pnpm', args: ['run', 'release-it'] }; execFileSync(options.command, options.args);",
    "import { execFileSync } from 'node:child_process'; const dispatch = execFileSync; const args = ['run', 'release-it']; dispatch('pnpm', args);",
    "import { execFileSync } from 'node:child_process'; execFileSync(process.env.PROOF_COMMAND, []);",
    "await fetch('https://api.' + 'cloudflare.com/client/v4/accounts/example', { method: 'POST' });",
    "import Cloudflare from 'cloudflare'; new Cloudflare();",
    "const cloudflare = await import('cloudflare');",
    "const sdk = require('cloudflare');",
    "const cli = require('wrangler');",
    "import { createRequire as makeRequire } from 'node:module'; const load = makeRequire(import.meta.url); const sdk = load('cloudflare');",
    "import { execFileSync } from 'node:child_process'; const cmd = process.env.CI ? 'pnpm' : 'echo'; const args = process.env.CI ? ['run', 'release-it'] : ['verified']; execFileSync(cmd, args);",
  ])("follows a local imported JS wrapper and its actual command arguments: %s", async (body) => {
    const root = await fixture("node scripts/validate.mjs", { "release-it": "pnpm hosted-demo:deploy" });
    await put(root, "scripts/validate.mjs", "import './wrappers/inner.mjs';\n");
    await put(root, "scripts/wrappers/inner.mjs", body);
    expect(() => audit(root)).toThrow(/No-deploy assertion/u);
  });

  it("evaluates imported command constants and requires dry-run inside opaque Cloudflare wrappers", async () => {
    const root = await fixture("node scripts/wrapper.mjs");
    await put(root, "scripts/command.mjs", "export const command = 'wrangler';");
    await put(root, "scripts/wrapper.mjs", "import { execFileSync as run } from 'node:child_process'; import { command as executable } from './command.mjs'; run(executable, ['deploy', '--dry-run', '--config', 'wrangler.jsonc']);");
    expect(() => audit(root)).not.toThrow();
    await put(root, "scripts/wrapper.mjs", "import { execFileSync as run } from 'node:child_process'; import { command as executable } from './command.mjs'; function ship(args) { run(executable, args); } ship(process.argv.slice(2));");
    expect(() => audit(root)).toThrow(/explicit Wrangler/u);
  });

  it("audits every new workflow job and a local composite action", async () => {
    const root = await fixture();
    await put(root, ".github/workflows/ci.yml", "jobs:\n  packed:\n    steps:\n      - run: |\n          node scripts/verify.mjs\n          pnpm hosted-demo:deploy\n");
    expect(() => audit(root)).toThrow(/hosted-demo:deploy/u);
    await put(root, ".github/workflows/ci.yml", "jobs:\n  packed:\n    steps:\n      - uses: ./.github/actions/check\n");
    await put(root, ".github/actions/check/action.yml", "runs:\n  using: composite\n  steps:\n    - run: pnpm hosted-demo:deploy\n      shell: bash\n");
    expect(() => audit(root)).toThrow(/hosted-demo:deploy/u);
  });

  it("discovers a fifth package and follows its command alias before any host command executes", async () => {
    const root = await fixture();
    await put(root, "packages/new-host/package.json", JSON.stringify({ name: "new-host", dependencies: { "zudo-composer": "workspace:*" }, scripts: { seed: "pnpm hidden", hidden: "wrangler deploy" } }));
    expect(() => audit(root)).toThrow(/Wrangler deploy --dry-run/u);
  });

  it("resolves doc workspace build/check scripts and accepts the local zfb binary", async () => {
    const root = await fixture("pnpm -C doc build");
    await put(root, "pnpm-workspace.yaml", "packages:\n  - doc\n");
    await put(root, "doc/package.json", JSON.stringify({ name: "doc", scripts: { build: "zfb build", check: "zfb check" } }));
    expect(() => audit(root)).not.toThrow();
  });

  it("audits lifecycle hooks for every pnpm workspace member", async () => {
    const root = await fixture("pnpm install");
    await put(root, "pnpm-workspace.yaml", "packages:\n  - doc\n");
    await put(root, "doc/package.json", JSON.stringify({ name: "doc", scripts: { postinstall: "wrangler deploy" } }));
    expect(() => audit(root)).toThrow(/Wrangler deploy --dry-run/u);
  });

  it("retains command discovery for non-workspace packages reached by local entries", async () => {
    const root = await fixture("pnpm -C external build");
    await put(root, "external/package.json", JSON.stringify({ scripts: { build: "zfb build", release: "wrangler deploy" } }));
    expect(() => audit(root)).toThrow(/Wrangler deploy --dry-run/u);
  });

  it.each([
    ["sites/*", "sites/docs"], ["sites/**", "sites/nested/docs"],
    ["{doc,sites/*}", "doc"], ["sites/[ab]", "sites/a"], ["sites/@(a|b)", "sites/b"],
  ])("discovers lifecycle hooks through workspace glob %s", async (pattern, member) => {
    const root = await fixture("pnpm install");
    await put(root, "pnpm-workspace.yaml", `packages:\n  - '${pattern}'\n`);
    await put(root, `${member}/package.json`, JSON.stringify({ scripts: { postinstall: "wrangler deploy" } }));
    expect(() => audit(root)).toThrow(/Wrangler deploy --dry-run/u);
  });

  it.each(["!members/legacy", "!./members/legacy", "!**/legacy/**"])("respects workspace exclusion %s and skips dependencies and unrelated directories", async (exclude) => {
    const root = await fixture("pnpm install");
    await put(root, "pnpm-workspace.yaml", `packages:\n  - 'members/**'\n  - '${exclude}'\n`);
    await put(root, "members/current/package.json", JSON.stringify({ scripts: { postinstall: "zfb build" } }));
    for (const path of ["members/legacy", "members/current/node_modules/untrusted", "unrelated"]) {
      await put(root, `${path}/package.json`, JSON.stringify({ scripts: { postinstall: "wrangler deploy" } }));
    }
    expect(() => audit(root)).not.toThrow();
  });

  it.each([null, "doc", [42], [""]])("rejects malformed workspace patterns instead of skipping their hooks: %j", async (packages) => {
    const root = await fixture("pnpm install");
    await put(root, "pnpm-workspace.yaml", `packages: ${JSON.stringify(packages)}\n`);
    expect(() => audit(root)).toThrow(/workspace packages must be an array/u);
  });

  it.each(["pre", "post"])("audits a local Node action's %s lifecycle entry", async (stage) => {
    const root = await fixture();
    await put(root, ".github/workflows/ci.yml", "jobs:\n  packed:\n    steps:\n      - uses: ./.github/actions/check\n");
    await put(root, ".github/actions/check/action.yml", `runs:\n  using: node24\n  main: main.mjs\n  ${stage}: lifecycle.mjs\n`);
    await put(root, ".github/actions/check/main.mjs", "console.log('verified');");
    await put(root, ".github/actions/check/lifecycle.mjs", "import { execFileSync } from 'node:child_process'; execFileSync('pnpm', ['hosted-demo:deploy']);");
    expect(() => audit(root)).toThrow(/hosted-demo:deploy/u);
  });

  it("scans generated manifest scripts and resolves aliases within that manifest", async () => {
    const root = await fixture();
    await put(root, "scripts/verify.mjs", "export const starter = { scripts: { check: 'pnpm hidden', hidden: 'wrangler deploy' } };");
    expect(() => audit(root)).toThrow(/Wrangler deploy --dry-run/u);
    await put(root, "scripts/verify.mjs", "const first = { scripts: { check: 'echo verified' } }; const second = { scripts: { check: 'wrangler deploy' } };");
    expect(() => audit(root)).toThrow(/Wrangler deploy --dry-run/u);
  });

  it("audits each inline Node command independently and resolves its relative imports from cwd", async () => {
    const root = await fixture(`node -e "console.log('verified')" && node -e "import './scripts/mutation.mjs'"`);
    await put(root, "scripts/mutation.mjs", "import { execSync } from 'node:child_process'; execSync('pnpm hosted-demo:deploy');");
    expect(() => audit(root)).toThrow(/hosted-demo:deploy/u);
  });

  it("refuses unaudited Docker action code and custom workflow shell executables", async () => {
    const root = await fixture();
    await put(root, ".github/workflows/ci.yml", "jobs:\n  packed:\n    steps:\n      - uses: ./.github/actions/check\n");
    await put(root, ".github/actions/check/action.yml", "runs:\n  using: docker\n  image: Dockerfile\n");
    expect(() => audit(root)).toThrow(/unreviewed local action runtime/u);
    await put(root, ".github/workflows/ci.yml", "jobs:\n  packed:\n    steps:\n      - run: echo verified\n        shell: pnpm hosted-demo:deploy {0}\n");
    expect(() => audit(root)).toThrow(/unreviewed workflow shell/u);
  });

  it("does not count comments and refuses hidden shell substitutions or unreviewed external actions", async () => {
    const safe = await fixture();
    await put(safe, "scripts/verify.mjs", "// execSync('pnpm hosted-demo:deploy');\nconsole.log('checked');");
    expect(() => audit(safe)).not.toThrow();
    const hidden = await fixture('echo "$(pnpm hosted-demo:deploy)"');
    expect(() => audit(hidden)).toThrow(/substitution/u);
    await put(safe, ".github/workflows/ci.yml", "jobs:\n  packed:\n    steps:\n      - uses: cloudflare/wrangler-action@v3\n");
    expect(() => audit(safe)).toThrow(/Cloudflare action/u);
  });
});

describe("CI and aggregate packed-host coverage", () => {
  it("builds and verifies the exact doc artifact before the five-target deployment handoff", async () => {
    const workflow = parse(await readFile(join(repositoryRoot, ".github/workflows/ci.yml"), "utf8"));
    const job = workflow.jobs["doc-site-build"];
    const checkout = job.steps.find((step: { uses?: string }) => step.uses?.startsWith("actions/checkout@"));
    expect(checkout.with?.["fetch-depth"] ?? 1).toBe(1);
    expect(job.steps.some((step: { "continue-on-error"?: boolean }) => step["continue-on-error"])).toBe(false);
    expect(job.steps.filter((step: { run?: string }) => step.run === "pnpm doc:build-site")).toHaveLength(1);
    const verify = job.steps.find((step: { run?: string }) => step.run?.includes("hosted-demo:verify"));
    expect(verify.run).toBe('pnpm hosted-demo:verify doc/dist "${{ github.sha }}"');
    expect(verify.env.HOSTED_DEMO_TARGET).toBe("doc");
    const upload = job.steps.find((step: { uses?: string }) => step.uses?.startsWith("actions/upload-artifact@"));
    expect(upload.uses).toBe(workflow.jobs["demo-sites-build"].steps.find((step: { uses?: string }) => step.uses?.startsWith("actions/upload-artifact@")).uses);
    expect(upload.with).toEqual({ name: "doc-site-${{ github.sha }}", path: "doc/dist", "if-no-files-found": "error", "retention-days": 7 });
    const production = parse(await readFile(join(repositoryRoot, ".github/workflows/hosted-demo-deploy.yml"), "utf8"));
    expect(production.jobs.deploy.strategy.matrix.include).toEqual([
      { target: "zudo-composer", artifact_name: "hosted-demo", dist_dir: "dist-hosted-demo" },
      { target: "webshop", artifact_name: "demo-site-webshop", dist_dir: "packages/demo-webshop/dist-site" },
      { target: "landing", artifact_name: "demo-site-landing", dist_dir: "packages/demo-landing/dist-site" },
      { target: "blog", artifact_name: "demo-site-blog", dist_dir: "packages/demo-blog/dist-site" },
      { target: "doc", artifact_name: "doc-site", dist_dir: "doc/dist" },
    ]);
    const manifest = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
    expect(shellCommands(manifest.scripts.check).slice(-3)).toEqual([["pnpm", "doc:check"], ["pnpm", "doc:build-site"], ["pnpm", "smoke:host-install"]]);
  });

  it("uses disk discovery for all four hosts, generated output and the retained synthesized proof", async () => {
    const workflow = parse(await readFile(join(repositoryRoot, ".github/workflows/ci.yml"), "utf8"));
    const matrixJob = workflow.jobs["packed-host-matrix"];
    const job = workflow.jobs["packed-host-install"];
    expect(job.needs).toBe("packed-host-matrix");
    expect(job.strategy.matrix).toBe("${{ fromJSON(needs.packed-host-matrix.outputs.matrix) }}");
    expect(job.strategy["fail-fast"]).toBe(false);
    expect(matrixJob.outputs.matrix).toBe("${{ steps.hosts.outputs.matrix }}");
    expect(matrixJob.steps.find((step: { id?: string }) => step.id === "hosts").run).toBe("node scripts/packed-host-matrix.mjs --github-output");
    const invocation = job.steps.find((step: { run?: string }) => step.run?.includes("smoke:host-install"));
    expect(invocation.run).toBe('pnpm smoke:host-install -- --host "$PACKED_HOST"');
    expect(invocation.env.PACKED_HOST).toBe("${{ matrix.host }}");
    const names = packedHostMatrix(repositoryRoot).host;
    expect(names).toEqual(expect.arrayContaining(["demo-blog", "demo-landing", "demo-studio", "demo-webshop", "generated", "self-host"]));
    expect(names.length).toBe(discoverPackedHosts(repositoryRoot).length + 2);
    const manifest = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
    expect(shellCommands(manifest.scripts.check)).toContainEqual(["pnpm", "smoke:host-install"]);
    expect(shellCommands(manifest.scripts.check)[0]).toEqual(["pnpm", "no-deploy:check"]);
  });
});
