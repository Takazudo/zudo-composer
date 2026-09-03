import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const fixture = resolve(process.cwd(), "server/site-project-local/__tests__/cli-fixture.ts");
function run(input: string, code?: string): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", fixture], { env: { ...process.env, ...(code ? { SITE_PROJECT_TEST_ERROR: code } : {}) }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(input);
  });
}

function runThrowing(input: string): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const previous = process.env.SITE_PROJECT_TEST_THROW;
  process.env.SITE_PROJECT_TEST_THROW = "1";
  return run(input).finally(() => {
    if (previous === undefined) delete process.env.SITE_PROJECT_TEST_THROW;
    else process.env.SITE_PROJECT_TEST_THROW = previous;
  });
}

describe("SiteProject CLI framing", () => {
  it.each(["", "not-json", "{}{}", "{\"a\":1} trailing"])("rejects blank, malformed, or concatenated input %#", async (input) => {
    const result = await run(input);
    expect(result.status).toBe(2);
    expect(result.stderr).toBe("");
    expect(result.stdout.endsWith("\n")).toBe(true);
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(result.stdout)).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: "malformed-request" }) }));
  });

  it.each([
    ["malformed-request", 2], ["unsupported-protocol", 2], ["validation", 2], ["compile-blocked", 2],
    ["not-found", 2], ["conflict", 2], ["unavailable", 1], ["internal", 1],
  ])("maps %s to exit %i with one canonical response", async (code, expected) => {
    const result = await run('{"operation":"test"}\n', code);
    expect(result).toEqual({ status: expected, stderr: "", stdout: `{"error":{"code":"${code}","message":"${code}"},"ok":false}\n` });
  });

  it("returns successful JSON with exit zero", async () => {
    await expect(run('{"z":1,"a":2}\n')).resolves.toEqual({ status: 0, stderr: "", stdout: '{"ok":true,"result":{"a":2,"z":1}}\n' });
  });

  it("maps an unexpected service rejection to a sanitized internal response", async () => {
    await expect(runThrowing('{}\n')).resolves.toEqual({
      status: 1, stderr: "", stdout: '{"error":{"code":"internal","message":"The SiteProject service failed unexpectedly."},"ok":false}\n',
    });
  });
});
