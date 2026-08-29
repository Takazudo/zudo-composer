import { appendFile } from "node:fs/promises";
import { deploymentCredentialState } from "./deployment-artifact-lib.mjs";

const state = deploymentCredentialState(process.env);
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `state=${state}\n`);

if (state === "partial") {
  throw new Error("Partial Cloudflare credentials: set both CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, or remove both.");
}
if (state === "absent") {
  console.log("Cloudflare deployment credentials are absent; deployment is intentionally skipped.");
} else {
  console.log("Cloudflare deployment credentials are complete.");
}
