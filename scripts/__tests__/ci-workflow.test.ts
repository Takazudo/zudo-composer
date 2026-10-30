import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { parse } from "yaml";

const root = join(import.meta.dirname, "../..");
type Job = { "timeout-minutes"?: number; steps: { run?: string; name?: string }[] };
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
