import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { parse } from "yaml";

const root = join(import.meta.dirname, "../..");
type Job = { "runs-on"?: string; "timeout-minutes"?: number; env?: Record<string, string>; steps: { run?: string; name?: string; uses?: string; if?: string; with?: Record<string, unknown> }[] };
const runs = (job: Job) => job.steps.map(step => step.run?.trim()).filter((run): run is string => run !== undefined);

it("keeps every validation command, each after its own preparation, with the long lanes outside validate's budget", async () => {
  const workflow = parse(await readFile(join(root, ".github/workflows/ci.yml"), "utf8")) as { jobs: Record<string, Job> };
  const all = Object.values(workflow.jobs).flatMap(runs);
  for (const command of ["pnpm contract:external-install", "pnpm ui:external-install", "pnpm test:browser:assistant", "pnpm test:browser:assistant:local-host"]) {
    expect(all.filter(run => run === command)).toHaveLength(1);
  }
  const handoffs = runs(workflow.jobs["package-handoffs"]!);
  expect(handoffs.indexOf("node scripts/prepare-packed-pnpm.mjs")).toBeLessThan(handoffs.indexOf("pnpm install --frozen-lockfile"));
  expect(handoffs.indexOf("pnpm install --frozen-lockfile")).toBeLessThan(handoffs.indexOf("pnpm contract:external-install"));
  const assistant = runs(workflow.jobs["assistant-browser"]!);
  expect(assistant.indexOf("pnpm exec playwright install --with-deps chromium")).toBeLessThan(assistant.indexOf("pnpm test:browser:assistant"));
  expect(assistant.indexOf("pnpm test:browser:assistant")).toBeLessThan(assistant.indexOf("pnpm test:browser:assistant:local-host"));
  const validate = runs(workflow.jobs.validate!);
  expect(validate).not.toContain("pnpm test:browser:assistant");
  expect(workflow.jobs.validate!["timeout-minutes"]).toBe(45);
});

it("runs both Content browser journeys serially in their own job, prepared, on Node 24 and pnpm 11.5.2, with failure artifacts", async () => {
  const workflow = parse(await readFile(join(root, ".github/workflows/ci.yml"), "utf8")) as { jobs: Record<string, Job> };
  const all = Object.values(workflow.jobs).flatMap(runs);
  for (const command of ["pnpm test:browser:content-history", "pnpm test:browser:content-ai"]) expect(all.filter(run => run === command)).toHaveLength(1);
  const job = workflow.jobs["content-browser"]!;
  const steps = runs(job);
  expect(steps.indexOf("pnpm install --frozen-lockfile")).toBeLessThan(steps.indexOf("pnpm exec playwright install --with-deps chromium"));
  expect(steps.indexOf("pnpm exec playwright install --with-deps chromium")).toBeLessThan(steps.indexOf("pnpm test:browser:content-history"));
  expect(steps.indexOf("pnpm test:browser:content-history")).toBeLessThan(steps.indexOf("pnpm test:browser:content-ai"));
  expect(job["runs-on"]).toBe("ubuntu-24.04");
  expect(job.steps.find(step => step.uses?.startsWith("pnpm/action-setup@"))?.with?.version).toBe("11.5.2");
  expect(job.steps.find(step => step.uses?.startsWith("actions/setup-node@"))?.with?.["node-version"]).toBe(24);
  const upload = job.steps.find(step => step.uses?.startsWith("actions/upload-artifact@"));
  expect(upload?.if).toBe("failure()");
  expect(job.env?.BLOG_PROOF_ARTIFACTS && String(upload?.with?.path)).toMatch(/^test-results\//);
  expect(job.env?.BLOG_PROOF_ARTIFACTS).toMatch(/^test-results\//);
  const scripts = JSON.parse(await readFile(join(root, "package.json"), "utf8")).scripts as Record<string, string>;
  expect(scripts["test:browser:content-history"]).toBe("node verification/content-editorial/blog-history-proof.mjs");
  expect(scripts["test:browser:content-ai"]).toBe("node verification/content-editorial/blog-ai-proof.mjs");
  expect(runs(workflow.jobs.validate!)).not.toContain("pnpm test:browser:content-ai");
});
