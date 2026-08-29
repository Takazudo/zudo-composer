import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const packageJson = JSON.parse(read("package.json"));
const config = JSON.parse(read("wrangler.jsonc"));
const workflow = read(".github/workflows/ci.yml");

function workflowStep(marker) {
  const markerIndex = workflow.indexOf(marker);
  assert.notEqual(markerIndex, -1, `workflow step is missing: ${marker}`);
  const stepBoundary = workflow.lastIndexOf("\n      - ", markerIndex);
  const start = stepBoundary < 0 ? markerIndex : stepBoundary + 1;
  const next = workflow.indexOf("\n      - ", markerIndex + marker.length);
  return workflow.slice(start, next < 0 ? workflow.length : next);
}

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
assert.ok(workflow.includes("group: ${{ github.workflow }}-${{ github.ref }}"), "CI must serialize each workflow ref");
assert.ok(workflow.includes("cancel-in-progress: true"), "new pushes must cancel stale validation/deployment runs");
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
assert.ok(workflow.includes("name: Production deploy or credential handoff"), "production job purpose must be explicit");
assert.ok(workflow.includes("## Production deployment handoff"), "absent credentials must write an actionable step summary");
for (const instruction of ["Edit Cloudflare Workers", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "GITHUB_STEP_SUMMARY"]) {
  assert.ok(workflow.includes(instruction), `credential handoff is missing ${instruction}`);
}
const deployJobStart = workflow.indexOf("  deploy:\n");
const deployStepsStart = workflow.indexOf("    steps:\n", deployJobStart);
assert.notEqual(deployJobStart, -1, "production deployment job is missing");
assert.notEqual(deployStepsStart, -1, "production deployment steps are missing");
assert.doesNotMatch(workflow.slice(deployJobStart, deployStepsStart), /\n {4}env:\n/, "Cloudflare credentials must not be job-scoped");
const credentialStep = workflowStep("id: credentials");
const deployStep = workflowStep("run: pnpm deploy\n");
const liveSmokeStep = workflowStep("run: pnpm smoke:live\n");
for (const step of [credentialStep, deployStep]) {
  assert.match(step, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/, "credential/deploy step is missing its scoped token");
  assert.match(step, /CLOUDFLARE_ACCOUNT_ID: \$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}/, "credential/deploy step is missing its scoped account ID");
}
for (const expression of [
  "${{ secrets.CLOUDFLARE_API_TOKEN }}",
  "${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
]) {
  assert.equal(workflow.split(expression).length - 1, 2, `${expression} must appear only on credential classification and deployment`);
}
assert.doesNotMatch(liveSmokeStep, /CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)/, "live smoke must not receive deployment credentials");
assert.match(workflow, /- run: pnpm deployment:manifest:check\n {6}- uses: actions\/upload-artifact@/, "artifact integrity must be rechecked immediately before upload");

for (const source of [JSON.stringify(config), workflow]) {
  assert.doesNotMatch(source, /zudo-sg\.takazudomodular\.com|name["']?\s*:\s*["']zudo-sg["']/i, "standalone deployment must not reuse zudo-sg identity");
}

console.log("Deployment boundary passed: exact Worker, domain, Wrangler, artifact, smoke, and credential gates are wired.");
