import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const packageJson = JSON.parse(read("package.json"));
const config = JSON.parse(read("wrangler.jsonc"));
const workflow = read(".github/workflows/ci.yml");

assert.equal(packageJson.devDependencies.wrangler, "4.127.1");
assert.equal(config.name, "zudo-composer");
assert.equal(config.compatibility_date, "2026-08-29");
assert.equal(config.workers_dev, false);
assert.equal(config.preview_urls, false);
assert.deepEqual(config.assets, {
  directory: "./dist",
  not_found_handling: "single-page-application",
});
assert.deepEqual(config.routes, [{
  pattern: "zudo-composer.takazudomodular.com",
  custom_domain: true,
}]);

assert.equal((workflow.match(/run: pnpm build\s*$/gm) ?? []).length, 1, "CI must build exactly once");
for (const command of [
  "pnpm headless:negative-scan",
  "pnpm provider:boundary",
  "pnpm deployment:boundary",
  "pnpm deploy:dry-run",
  "pnpm test:browser:dist",
  "pnpm deployment:manifest",
  "pnpm deployment:manifest:check",
  "pnpm smoke:local",
  "pnpm smoke:live",
]) assert.ok(workflow.includes(command), `CI is missing ${command}`);
assert.ok(workflow.includes("CLOUDFLARE_API_TOKEN: \"\""), "dry-run must explicitly be unauthenticated");
assert.ok(workflow.includes("check-deploy-credentials.mjs"), "deployment must classify absent/partial/complete credentials");

for (const source of [JSON.stringify(config), workflow]) {
  assert.doesNotMatch(source, /zudo-sg\.takazudomodular\.com|name["']?\s*:\s*["']zudo-sg["']/i, "standalone deployment must not reuse zudo-sg identity");
}

console.log("Deployment boundary passed: exact Worker, domain, Wrangler, artifact, smoke, and credential gates are wired.");
