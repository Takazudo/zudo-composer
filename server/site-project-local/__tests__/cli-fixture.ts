import type { SiteProjectApiErrorCode, SiteProjectApiService } from "../../../src/site-project/api/types";
import { runSiteProjectCli } from "../cli-runner";

const code = process.env.SITE_PROJECT_TEST_ERROR as SiteProjectApiErrorCode | undefined;
const service: SiteProjectApiService = {
  async handle(request) {
    if (process.env.SITE_PROJECT_TEST_THROW === "1") throw new Error("private");
    if (code) return { ok: false, error: { code, message: code } };
    return { ok: true, result: request as never };
  },
  async serialize() { throw new Error("unused"); },
};
process.exitCode = await runSiteProjectCli(service, { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr });
